/**
 * Supabase Edge Function：stock-report（盤後籌碼報告產生器）
 *
 * 由伺服器端代抓 TWSE 盤後籌碼並產出**結構化資料**（schema 2 起不再產生 HTML，
 * 畫面一律由前端 React 繪製）。報告內嵌最近 7 個交易日的 history 供前端自繪走勢圖。
 * 共用 raw 檔快取（chip_raw_cache 資料表，見 sources/supabase/schema.sql）。
 * 部署方式（需安裝 Supabase CLI 並登入）：
 *   supabase functions deploy stock-report --no-verify-jwt
 *
 * 介面：
 *   POST { action: 'generate', market: 'TPE', ticker: string, name: string, holding?: HoldingContext }
 *     → { reportId, generatedAt, dataDate, data }（籌碼即點即產，前端 fallback 用）
 *   POST { action: 'warm', ticker: string }
 *     → { ok, ticker, ymd, dailySynced, fundamentalSynced }
 *       單檔補上日線與基本面並寫入 Storage，供新加入的股票不必等夜間批次（0.6.0-dev.7）
 *   POST { action: 'generate-all' }  header: x-cron-secret（盤後 pg_cron 觸發）
 *     → 產生全體持有台股的共用報告存入 Storage(reports bucket)，並清理超過 7 天的舊資料
 *   POST { action: 'sync-macro' }  header: x-cron-secret（由 macro-daily 排程觸發）
 *     → 抓 FRED 五個序列寫入 macro/us.json（全域單檔）。與台股交易日無關，故獨立排程。
 *   POST { action: 'sync-fx' }  header: x-cron-secret（由 fx-daily 排程觸發）
 *     → 抓 Yahoo 八個幣對寫入 fx/twd.json（全域單檔）。與台股交易日無關，故獨立排程。
 *   POST { action: 'backfill-revenue' }  header: x-cron-secret
 *     → 由 MOPS 分月報表把 fundamental/{ticker}.json 的月營收補到 12 個月（0.6.4）。
 *       generate-all 每輪也會順手跑一次，這個入口是給「不想等排程」用的。
 *
 * `generate` 與 `warm` 都以 heldTwTickers() 白名單把關：本函式以 --no-verify-jwt 部署，
 * 網址就在公開的前端 bundle 裡，白名單是把濫用上限壓到最低的那道防線（見 0.3.9 紀錄）。
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  UA,
  fetchJson,
  t86Url,
  marginDatedUrl,
  marginDatedOk,
  MI_MARGN_URL,
  BORROW_DATED_URL,
  borrowDatedOk,
  borrowDatedDate,
  extractBorrowDated,
  type BorrowDatedResponse,
  extractInstitutional,
  extractMargin,
  extractMarginDated,
  extractBorrow,
  type MarginDatedResponse,
  type T86ResponseShape,
} from './twChips.ts'
import {
  buildReport,
  dashDate,
  isWeekendYmd,
  taipeiYmd,
  tradingDateCandidates,
  type ChipDay,
  type HoldingContext,
  type ReportSources,
  type SourceStamp,
} from './report.ts'
import {
  DAILY_SCHEMA,
  dailyUrl,
  extractDaily,
  yahooDailySymbols,
  type ChartResponse,
  type DailyFile,
} from './twDaily.ts'
import {
  BWIBBU_ALL_URL,
  FUNDAMENTAL_SCHEMA,
  T187AP03_URL,
  T187AP05_URL,
  T187AP17_URL,
  buildFundamentalFile,
  extractIndustry,
  extractProfit,
  extractRevenue,
  extractValuation,
  mergeRevenueMonths,
  REVENUE_MONTHS_CAP,
  type FundamentalFile,
  type RevenueMonth,
} from './twFundamental.ts'
import {
  MOPS_MARKETS,
  mopsRevenueUrl,
  nextBackfilledThrough,
  parseMopsRevenue,
  planRevenueBackfill,
  publishedMonths,
  type RevenueProgress,
} from './twRevenueHistory.ts'
import { NEWS_SCHEMA, googleNewsRssUrl, parseGoogleNewsRss, type NewsFile } from './twNews.ts'
import {
  FRED_SERIES,
  MACRO_LOOKBACK_MONTHS,
  MACRO_SCHEMA,
  deriveIndicator,
  fredCsvUrl,
  fredSinceDate,
  MACRO_UA,
  parseFredCsv,
  type MacroFile,
  type MacroIndicator,
} from './usMacro.ts'
import {
  FX_CURRENCIES,
  FX_MIN_POINTS,
  FX_SCHEMA,
  buildCurrency,
  extractFxPoints,
  fxUrl,
  type FxCurrency,
  type FxFile,
} from './fxRates.ts'
import {
  decideSkip,
  nextT86State,
  rowsFingerprint,
  runSignature,
  t86Fingerprint,
  type T86State,
} from './pollPlan.ts'

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Supabase 執行環境自動注入；
// service role 不受 RLS 限制，是 chip_raw_cache 唯一的讀寫途徑
const db = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

const TICKER_RE = /^[0-9A-Za-z]{2,8}$/

/** 報告內嵌的歷史交易日數（**交易日**，不是日曆日） */
const HISTORY_DAYS = 7
/** 往回推的日曆天數，需足夠涵蓋 HISTORY_DAYS 個交易日（含週末與連假） */
const LOOKBACK_DAYS = 14
/** 單次呼叫最多實抓幾個缺漏日；Edge Function 有 wall-clock 上限，不足的隔日排程補齊 */
const MAX_BACKFILL_DAYS = 5
/**
 * 月營收歷史回補：單次呼叫最多實抓幾個月。
 * 一個月要抓上市＋上櫃兩份、各約 400KB，同 MAX_BACKFILL_DAYS 的理由 ——
 * Edge Function 的 CPU / wall-clock 上限才是這條路徑最緊的一條線，不是資料量。
 * 補滿 REVENUE_MONTHS_CAP（12）個月約需 3 輪，一個晚上的排程就跑得完。
 */
const MAX_BACKFILL_MONTHS = 4
/** 同時進行的外部抓取數上限（T86 單檔約 1–2MB） */
const FETCH_CONCURRENCY = 3

function t86Ok(r: T86ResponseShape): boolean {
  const data = r.data ?? r.tables?.[0]?.data
  return r.stat === 'OK' && Array.isArray(data) && data.length > 0
}

export function makeReportId(dateYmd: string, ticker: string): string {
  return `${dateYmd}_${ticker}_${crypto.randomUUID().slice(0, 8)}`
}

/**
 * 各 dataset 最近一次寫入快取的時間。這就是「這份資料我們是什麼時候抓到的」——
 * 不必另建欄位，`chip_raw_cache.updated_at` 本來就記著。
 */
const fetchedAtByDataset = new Map<string, string>()

async function readCache<T>(ymd: string, dataset: string): Promise<T | null> {
  try {
    const { data, error } = await db
      .from('chip_raw_cache')
      .select('payload, updated_at')
      .eq('ymd', ymd)
      .eq('dataset', dataset)
      .maybeSingle()
    if (error || !data?.payload) return null
    if (data.updated_at) fetchedAtByDataset.set(`${ymd}:${dataset}`, String(data.updated_at))
    return data.payload as T
  } catch {
    return null
  }
}

async function writeCache(ymd: string, dataset: string, payload: unknown): Promise<void> {
  try {
    const now = new Date().toISOString()
    fetchedAtByDataset.set(`${ymd}:${dataset}`, now)
    await db.from('chip_raw_cache').upsert({
      ymd,
      dataset,
      payload,
      updated_at: now,
    })
  } catch {
    // 快取寫入失敗不影響主流程
  }
}

/**
 * 哪些 (日期, dataset) 組合已有快取，回傳 `${ymd}:${dataset}` 集合。
 * 只查鍵、不取 payload —— 每筆 payload 是 1–2MB，全撈回來會直接吃爆記憶體。
 * 必須逐 dataset 判斷：v1 時期只快取了 T86，那些日子仍需補抓 MI_MARGN_D。
 */
async function cachedDayDatasets(candidates: string[]): Promise<Set<string>> {
  try {
    const { data, error } = await db
      .from('chip_raw_cache')
      .select('ymd, dataset')
      .in('dataset', ['T86', 'MI_MARGN_D'])
      .in('ymd', candidates)
    if (error || !data) return new Set()
    return new Set(data.map((r) => `${String(r.ymd)}:${String(r.dataset)}`))
  } catch {
    return new Set()
  }
}

/** 讀取「最新交易日」型的 whole-market 檔（無 date 參數），按解析日期快取於 Postgres */
async function readLatest<T>(ymd: string, dataset: string, url: string): Promise<T | null> {
  const cached = await readCache<T>(ymd, dataset)
  if (cached) return cached
  try {
    const data = await fetchJson<T>(url)
    await writeCache(ymd, dataset, data)
    return data
  } catch {
    return null
  }
}

// ---- 逐日籌碼序列 ----

/** 一天的全市場原始檔。用完即棄：抽出各代號的籌碼後就釋放，避免同時持有數十 MB */
interface DayRaw {
  ymd: string
  t86: T86ResponseShape
  margin: MarginDatedResponse | null
}

/** 一天中「我們關心的代號」的籌碼（以 ticker 為鍵） */
interface DaySlice {
  ymd: string
  chips: Map<string, ChipDay>
}

/**
 * 這一輪抓到的 T86 內容指紋，以 ymd 為鍵。
 * 每次 `handleGenerateAll` 開頭清空，避免同一個 isolate 跨請求殘留。
 */
const t86FingerprintByYmd = new Map<string, string>()

/**
 * 讀某日 T86（快取優先）；非交易日 / 尚未收盤回 null。fetch=false 時只讀快取。
 *
 * `refresh=true` 時**即使已有快取也重抓一次並比對** —— 這是 0.6.1 輪詢的核心。
 * T86 自 16:00 起每 15 分鐘更新一次，當天第一次抓到的不一定是定稿；
 * 原本「第一次抓到就快取、之後永不更新」的作法會把初版鎖成當天的答案，
 * 比晚抓一次還糟。只有今天、且尚未定稿的那一天會走這條路（見 pollPlan.nextT86State）。
 */
async function loadT86(
  ymd: string,
  fetchAllowed: boolean,
  refresh = false,
): Promise<T86ResponseShape | null> {
  const cached = await readCache<T86ResponseShape>(ymd, 'T86')
  if (cached && t86Ok(cached) && !refresh) {
    t86FingerprintByYmd.set(ymd, t86Fingerprint(cached))
    return cached
  }
  if (!fetchAllowed && !refresh) return null
  try {
    const resp = await fetchJson<T86ResponseShape>(t86Url(ymd))
    if (!t86Ok(resp)) {
      // 非交易日 / 尚未發布：不快取空回應。重抓模式下已有的快取仍然有效，
      // 不能因為這次拿到空的就把好資料丟掉。
      if (cached && t86Ok(cached)) {
        t86FingerprintByYmd.set(ymd, t86Fingerprint(cached))
        return cached
      }
      return null
    }
    const fp = t86Fingerprint(resp)
    t86FingerprintByYmd.set(ymd, fp)
    // 內容沒變就別重寫，省下 194KB 的 UPSERT 與隨之而來的 dead tuple
    if (!cached || !t86Ok(cached) || t86Fingerprint(cached) !== fp) {
      await writeCache(ymd, 'T86', resp)
    }
    return resp
  } catch {
    return cached && t86Ok(cached) ? cached : null
  }
}

/** 讀某日帶 date 的融資融券（快取優先）；端點格式變動或抓取失敗回 null */
async function loadMarginDated(ymd: string, fetchAllowed: boolean): Promise<MarginDatedResponse | null> {
  const cached = await readCache<MarginDatedResponse>(ymd, 'MI_MARGN_D')
  if (cached && marginDatedOk(cached)) return cached
  if (!fetchAllowed) return null
  try {
    const resp = await fetchJson<MarginDatedResponse>(marginDatedUrl(ymd))
    if (!marginDatedOk(resp)) return null
    await writeCache(ymd, 'MI_MARGN_D', resp)
    return resp
  } catch {
    return null
  }
}

async function loadDayRaw(
  ymd: string,
  allow: { t86: boolean; margin: boolean; refreshT86?: boolean },
): Promise<DayRaw | null> {
  const t86 = await loadT86(ymd, allow.t86, allow.refreshT86 ?? false)
  if (!t86) return null // T86 是交易日的判定依據，沒有就當這天沒資料
  const margin = await loadMarginDated(ymd, allow.margin)
  return { ymd, t86, margin }
}

/** 把一天的原始大檔壓成只含目標代號的切片，隨即釋放 raw */
function sliceDay(raw: DayRaw, tickers: string[]): DaySlice {
  const date = dashDate(raw.ymd)
  const chips = new Map<string, ChipDay>()
  for (const ticker of tickers) {
    chips.set(ticker, {
      date,
      institutional: extractInstitutional(raw.t86, ticker),
      margin: raw.margin ? extractMarginDated(raw.margin, ticker) : null,
    })
  }
  return { ymd: raw.ymd, chips }
}

export interface SeriesResult {
  /** 由舊到新的交易日切片，最多 HISTORY_DAYS 筆；空陣列代表完全無資料 */
  days: DaySlice[]
  /** 最新交易日 YYYYMMDD（無資料時退回最近的非週末候選日當標示） */
  dataYmd: string
  /** 是否因抓取額度用盡而少於 HISTORY_DAYS 天 */
  incomplete: boolean
  /** rwd 融資融券是否整批不可用（呼叫端據此回退 OpenAPI） */
  marginDatedFailed: boolean
}

/**
 * 組出最近 HISTORY_DAYS 個交易日的籌碼序列。
 *
 * 策略（見 docs/agent/PLAN.md §E）：
 * - 候選日往回推 LOOKBACK_DAYS 個日曆日，先剔除週六日（必定非交易日，省下白抓）。
 * - 已有快取的日子不佔抓取額度；其餘以 FETCH_CONCURRENCY 併發抓取。
 * - 單次呼叫最多實抓 MAX_BACKFILL_DAYS 個缺漏日，收集滿 HISTORY_DAYS 天即停。
 */
async function loadSeries(
  tickers: string[],
  now: Date,
  opts?: { refreshT86Ymd?: string },
): Promise<SeriesResult> {
  const candidates = tradingDateCandidates(now, LOOKBACK_DAYS - 1).filter((d) => !isWeekendYmd(d))
  const cached = await cachedDayDatasets(candidates)
  let fetchBudget = MAX_BACKFILL_DAYS
  const collected: DaySlice[] = []
  let marginSeen = false

  // 由新到舊分批處理；同批內併發，批間序列，以此同時控住併發數與總抓取量
  for (let i = 0; i < candidates.length && collected.length < HISTORY_DAYS; i += FETCH_CONCURRENCY) {
    const batch = candidates.slice(i, i + FETCH_CONCURRENCY)
    const jobs: Array<Promise<DayRaw | null>> = []
    for (const ymd of batch) {
      // 今天且尚未定稿時強制重抓比對；不佔 fetchBudget（那是給回補缺漏日用的額度，
      // 今天這一份是輪詢的主角，不能被回補排擠掉）
      const refreshT86 = opts?.refreshT86Ymd === ymd
      if (refreshT86) {
        jobs.push(loadDayRaw(ymd, { t86: true, margin: !cached.has(`${ymd}:MI_MARGN_D`), refreshT86: true }))
        continue
      }
      const needT86 = !cached.has(`${ymd}:T86`)
      const needMargin = !cached.has(`${ymd}:MI_MARGN_D`)
      if (fetchBudget <= 0) {
        // 額度用盡：T86 沒快取就無從判定是不是交易日，只能跳過；
        // T86 有快取則照樣出圖，那天單純沒有融資融券資料。
        if (needT86) continue
        jobs.push(loadDayRaw(ymd, { t86: false, margin: false }))
        continue
      }
      if (needT86 || needMargin) fetchBudget--
      jobs.push(loadDayRaw(ymd, { t86: needT86, margin: needMargin }))
    }
    const raws = await Promise.all(jobs)
    for (const raw of raws) {
      if (!raw) continue
      if (raw.margin) marginSeen = true
      collected.push(sliceDay(raw, tickers))
    }
  }

  // collected 為由新到舊；轉成由舊到新並裁到 HISTORY_DAYS
  collected.sort((a, b) => a.ymd.localeCompare(b.ymd))
  const days = collected.slice(-HISTORY_DAYS)
  const latest = days[days.length - 1]
  return {
    days,
    dataYmd: latest?.ymd ?? candidates[0] ?? '',
    incomplete: days.length < HISTORY_DAYS,
    marginDatedFailed: days.length > 0 && !marginSeen,
  }
}

interface GenerateReportRequestBody {
  action?: string
  market?: string
  ticker?: string
  name?: string
  holding?: HoldingContext | null
}

type MarginRows = Record<string, string>[] | null
type SblRows = Parameters<typeof extractBorrow>[0] | null

/** 由已抓好的序列組出單一代號的報告資料。holding 為 null 時前端不顯示持股概況。 */
function assembleOne(opts: {
  ticker: string
  name: string
  holding: HoldingContext | null
  series: SeriesResult
  marginFallbackRows: MarginRows
  borrow: BorrowSource
}): ReturnType<typeof buildReport> {
  const { ticker, name, holding, series, marginFallbackRows, borrow: borrowSrc } = opts
  const notes: string[] = []

  // 複製一份再組：series 的切片可能被多個代號共用讀取，下面的 fallback 會就地補值
  const history: ChipDay[] = series.days.map((d) => {
    const chip = d.chips.get(ticker)
    return chip ? { ...chip } : { date: dashDate(d.ymd), institutional: null, margin: null }
  })
  const latest = history[history.length - 1] ?? null

  if (series.days.length === 0) {
    notes.push('三大法人資料暫無（可能尚未收盤或逢假日）。')
  } else if (series.incomplete) {
    notes.push(
      `歷史資料回補中：目前只取到 ${history.length} 個交易日（共需 ${HISTORY_DAYS} 天），走勢圖會逐日補齊。`,
    )
  }

  // rwd 端點整批失敗時，用 OpenAPI 補上「最新交易日」的餘額（缺買進 / 賣出拆項）
  if (latest && latest.margin === null && marginFallbackRows) {
    const fallback = extractMargin(marginFallbackRows, ticker)
    if (fallback) {
      latest.margin = fallback
      notes.push('融資融券改用備援來源，只有今日餘額，無買進 / 賣出拆項與走勢。')
    }
  }
  if (latest && latest.margin === null) {
    // 分段執行下這是常態而非故障：早班跑的時候融資融券根本還沒公布
    notes.push('今日融資融券尚未公布（約 21:00–22:00），稍晚會自動補上。')
  }

  const borrow = borrowSrc.resp
    ? extractBorrowDated(borrowSrc.resp, ticker)
    : borrowSrc.fallbackRows
      ? extractBorrow(borrowSrc.fallbackRows, ticker)
      : null

  if (latest && latest.institutional === null && latest.margin === null) {
    notes.push('此代號查無上市籌碼資料（可能為上櫃 / 興櫃，暫不支援上櫃）。')
  }

  const stamp = (ymd: string, dataset: string, date: string | null): SourceStamp | null => {
    const fetchedAt = fetchedAtByDataset.get(`${ymd}:${dataset}`) ?? null
    return date === null && fetchedAt === null ? null : { date, fetchedAt }
  }
  const latestYmd = series.dataYmd
  const sources: ReportSources = {
    institutional:
      latest?.institutional !== null && latest !== null
        ? stamp(latestYmd, 'T86', latest.date)
        : null,
    margin: latest?.margin ? stamp(latestYmd, 'MI_MARGN_D', latest.date) : null,
    borrow: borrowSrc.date
      ? stamp(borrowSrc.date.replace(/-/g, ''), 'SBL_D', borrowSrc.date)
      : null,
  }

  return buildReport({
    ticker,
    name,
    dataDateYmd: series.dataYmd,
    holding,
    history,
    borrow,
    sources,
    notes,
  })
}

/** 取「日期 >= minYmd」中最新的一份借券快取；查無回 null（見 loadBorrow 的說明） */
async function readBorrowCacheFrom(
  minYmd: string,
): Promise<{ resp: BorrowDatedResponse; date: string } | null> {
  try {
    const { data, error } = await db
      .from('chip_raw_cache')
      .select('ymd, payload')
      .eq('dataset', 'SBL_D')
      .gte('ymd', minYmd)
      .order('ymd', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data?.payload) return null
    const resp = data.payload as BorrowDatedResponse
    if (!borrowDatedOk(resp)) return null
    return { resp, date: borrowDatedDate(resp) ?? dashDate(String(data.ymd)) }
  } catch {
    return null
  }
}

interface BorrowSource {
  resp: BorrowDatedResponse | null
  /** rwd 版回應 title 裡的日期（＝下一個交易日）；用 OpenAPI fallback 時為 null */
  date: string | null
  fallbackRows: SblRows
}

/**
 * 借券：優先用自帶日期的 rwd 版。
 *
 * **為什麼要先看日期再快取**：借券端點沒有 date 參數，回的永遠是「目前最新」。
 * 批次改成一天分段跑好幾次之後，早班（17:30）拿到的其實是前一天的資料 ——
 * 若照舊直接存成今天，後面幾班會因為「快取已存在」而永遠沿用那份錯的。
 * 改成解析 title 的日期後就變成可驗證的：拿到什麼日期就存成什麼日期，
 * 早班存前一天（本來就對），晚班拿到新的自然會寫進新的鍵，不會互相污染。
 */
async function loadBorrow(minYmd?: string): Promise<BorrowSource> {
  // 0.6.1：借券端點沒有 date 參數，原本每次執行都無條件重抓一次（244KB）。
  // 三班時代那是一天 3 次，改成 32 次輪詢後就是一天 7.8MB 的純浪費。
  // 已經有「日期 >= 今天」的快取就直接用 —— 那份就是我們要的最新額度。
  if (minYmd) {
    const cached = await readBorrowCacheFrom(minYmd)
    if (cached) return { resp: cached.resp, date: cached.date, fallbackRows: null }
  }
  let resp: BorrowDatedResponse | null = null
  try {
    resp = await fetchJson<BorrowDatedResponse>(BORROW_DATED_URL)
  } catch {
    resp = null
  }
  if (resp && borrowDatedOk(resp)) {
    const date = borrowDatedDate(resp)!
    const ymd = date.replace(/-/g, '')
    // 以「資料自己宣告的日期」為鍵，而不是我們正在處理的交易日
    const cached = await readCache<BorrowDatedResponse>(ymd, 'SBL_D')
    if (!cached) await writeCache(ymd, 'SBL_D', resp)
    return { resp, date, fallbackRows: null }
  }
  return { resp: null, date: null, fallbackRows: null }
}

/** OpenAPI 融資融券沒有 date 參數，只在 rwd 整批失敗時當備援 */
async function loadMarginFallback(dataYmd: string, needed: boolean): Promise<MarginRows> {
  return needed
    ? await readLatest<Record<string, string>[]>(dataYmd, 'MI_MARGN', MI_MARGN_URL)
    : null
}

async function handleGenerate(body: GenerateReportRequestBody): Promise<Response> {
  if (body.market !== 'TPE') {
    return json({ error: '盤後籌碼報告僅支援台股（TPE）' }, 400)
  }
  const ticker = String(body.ticker ?? '').trim()
  if (!TICKER_RE.test(ticker)) {
    return json({ error: 'ticker 格式不正確' }, 400)
  }
  const name = String(body.name ?? '').trim().slice(0, 40)
  const holding = body.holding ?? null

  /*
   * 這個端點以 --no-verify-jwt 部署（夜間 cron 只帶 x-cron-secret 進來），
   * 也就是任何人拿到專案網址就能呼叫 —— 而網址就在 GitHub Pages 的公開 bundle 裡。
   *
   * 限制只接受「確實有人持有」的代號，把濫用的上限壓到最低：
   * 攻擊者最多只能打這幾檔，而它們的當日資料早已被夜間批次快取，
   * 因此無法逼這個專案去大量抓 TWSE（放大效應歸零），只剩單純的 DB 讀取。
   * 回應刻意不透露清單內容或長度。
   */
  const held = await heldTwTickers()
  if (!held.some((h) => h.ticker === ticker)) {
    return json({ error: '此代號不在持股清單內，無法產生報告' }, 403)
  }

  const series = await loadSeries([ticker], new Date())
  const marginFallbackRows = await loadMarginFallback(
    series.dataYmd,
    series.marginDatedFailed || series.days.length === 0,
  )
  const borrow = await loadBorrow()
  const data = assembleOne({ ticker, name, holding, series, marginFallbackRows, borrow })

  const reportId = makeReportId(series.dataYmd, ticker)
  return json({ reportId, generatedAt: data.generatedAt, dataDate: data.dataDate, data })
}

// ---- 盤後批次：產生全體持有台股的共用報告存入 Storage(reports bucket)，保留最近 7 天 ----

const REPORTS_BUCKET = 'reports'

/** 報告在 Storage 保留幾個**日曆日**。前端只讀 manifest 指到的最新一份，舊的純粹留著備查 */
const REPORT_RETAIN_DAYS = 7
/**
 * 原始檔快取保留幾個**日曆日**，必須涵蓋整個 LOOKBACK_DAYS 視窗。
 *
 * 為什麼不是 7：`HISTORY_DAYS` 數的是**交易日**，而 prune 砍的是**日曆日** ——
 * 7 個交易日要跨 9–11 個日曆日。用 7 天會把隔天還要用的 2–3 天一起砍掉，
 * 於是每晚的批次都得重抓那幾天（實測正式區 prune 後只剩 6 個交易日可用，
 * 每次 generate 都還在補抓）。設成與 LOOKBACK_DAYS 相同最不容易再錯：
 * 那正是 loadSeries 會回頭找的範圍，更舊的資料本來就永遠不會被讀到。
 */
const CACHE_RETAIN_DAYS = LOOKBACK_DAYS

/** generate-all 會寫 Storage，端點為公開(--no-verify-jwt)，故要求 x-cron-secret 與環境變數相符 */
function assertCronSecret(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const got = req.headers.get('x-cron-secret') ?? ''
  if (!expected || got !== expected) return json({ error: 'Unauthorized' }, 401)
  return null
}

function ymdMinusDays(ymd: string, days: number): string {
  const dt = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)))
  dt.setUTCDate(dt.getUTCDate() - days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`
}

/** 全體使用者「淨持有（買 − 賣 > 0）」的台股代號（service role 掃 transactions；跨使用者去重） */
async function heldTwTickers(): Promise<Array<{ ticker: string; name: string }>> {
  const { data, error } = await db
    .from('transactions')
    .select('ticker, name, tx_type, qty')
    .eq('market', 'TPE')
  if (error || !data) return []
  const acc = new Map<string, { net: number; name: string }>()
  for (const row of data) {
    const ticker = String(row.ticker ?? '').trim()
    if (!TICKER_RE.test(ticker)) continue
    const qty = Number(row.qty) || 0
    const delta = row.tx_type === 'BUY' ? qty : -qty
    const prev = acc.get(ticker) ?? { net: 0, name: '' }
    acc.set(ticker, { net: prev.net + delta, name: String(row.name ?? '').trim() || prev.name })
  }
  return [...acc.entries()]
    .filter(([, v]) => v.net > 0)
    .map(([ticker, v]) => ({ ticker, name: v.name }))
}

async function uploadJson(path: string, payload: unknown): Promise<boolean> {
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const { error } = await db.storage.from(REPORTS_BUCKET).upload(path, blob, {
      upsert: true,
      contentType: 'application/json; charset=utf-8',
      // ⚠️ 一定要明寫。不給的話 supabase-js 預設 3600，Storage 就回
      // `cache-control: public, max-age=3600`，前端拿到的資料會整整舊一小時，
      // 而且 Ctrl+Shift+R 救不了（硬重整不涵蓋 JS 發出的 fetch）——0.6.4-dev.5 的線上事故。
      // 這些檔一天最多更新 32 次，讓它每次重新驗證的成本遠低於顯示錯誤資料。
      cacheControl: '0',
    })
    return !error
  } catch {
    return false
  }
}

async function downloadJson<T>(path: string): Promise<T | null> {
  try {
    const { data, error } = await db.storage.from(REPORTS_BUCKET).download(path)
    if (error || !data) return null
    return JSON.parse(await data.text()) as T
  } catch {
    return null
  }
}

// ---- 日線 OHLCV（技術面用）----

/**
 * 每檔台股抓一年日線存成 daily/{ticker}.json（整份覆寫）。
 *
 * 為什麼是 Storage 單檔覆寫、而不是 PLAN §G 原本設想的 price_daily 資料表：
 * 1. **沒有保留期問題**。覆寫不累積，不需要 prune —— 而 prune 的保留期單位錯配
 *    正是 0.3.9 修過的坑（砍日曆日 vs 數交易日），不要再製造第二個。
 * 2. **前端直接下載，不耗 Edge Function 額度**（0.3.9 的教訓：額度燒光會連帶讓 stock-price 停擺）。
 * 代價是每晚重抓整年而非增量，但 5 檔持股 = 5 個請求，可忽略。
 *
 * 跳過條件：既有檔案的 lastDate 已達本次的資料日就不重抓。三段式 cron 一天跑三次，
 * 17:30 那班抓到後，22:30 / 23:30 兩班會直接跳過。
 */
async function syncDaily(
  tickers: Array<{ ticker: string; name: string }>,
  dataYmd: string,
  opts?: { onDemand?: boolean },
): Promise<number> {
  const targetDate = dashDate(dataYmd)
  let synced = 0
  for (const { ticker } of tickers) {
    try {
      const existing = await downloadJson<DailyFile>(`daily/${ticker}.json`)
      if (existing && existing.schema === DAILY_SCHEMA) {
        if (existing.lastDate >= targetDate) continue
        // 即點即產專用：今天已經查過、確認查無資料，就別再對外打一次。
        // 夜間批次刻意不看這個條件——三班要留給剛上市、Yahoo 還沒補資料的代號重試的機會。
        if (opts?.onDemand && (existing.emptyCheckedDate ?? '') >= targetDate) continue
      }

      let rows: ReturnType<typeof extractDaily> = []
      for (const symbol of yahooDailySymbols(ticker)) {
        const resp = await fetchJson<ChartResponse>(dailyUrl(symbol))
        rows = extractDaily(resp)
        if (rows.length > 0) break
      }

      // 查無資料也要寫檔（空殼＋查詢日）：即點即產靠它才不會每次開頁重抓。
      // 理由與批次仍會重試的原因見 twDaily.ts 的 emptyCheckedDate 註解。
      const file: DailyFile =
        rows.length === 0
          ? {
              schema: DAILY_SCHEMA,
              ticker,
              asOf: new Date().toISOString(),
              lastDate: '',
              rows: [],
              emptyCheckedDate: targetDate,
            }
          : {
              schema: DAILY_SCHEMA,
              ticker,
              asOf: new Date().toISOString(),
              lastDate: rows[rows.length - 1][0],
              rows,
            }
      if (await uploadJson(`daily/${ticker}.json`, file)) synced++
    } catch {
      // 單檔失敗不影響其他檔，也不影響籌碼報告（與 borrow / margin 的容錯一致）
    }
  }
  return synced
}

// ---- 基本面（估值 + 月營收 + 產業別）----

/**
 * 每檔台股產出 fundamental/{ticker}.json（整份覆寫，佈局同 daily/：
 * 不符 pruneStorage 的 ^\d{8}$ 目錄名，不會被清、也不需要清）。
 *
 * 三份 whole-market 大檔在迴圈外各載一次（chip_raw_cache 以本次交易日快取，
 * 頭班實抓、後兩班吃快取），迴圈內只做逐代號抽取。
 * revenueMonths 讀回既有檔合併：覆寫制檔案靠這個自累積月營收史（首月 1 筆→12 筆）。
 * 上櫃股三份都查無：仍寫檔（nulls + notes），讓前端能區分「跑過但無料」與「還沒跑」。
 */
async function syncFundamental(
  tickers: Array<{ ticker: string; name: string }>,
  dataYmd: string,
): Promise<{ synced: number; bwibbuDate: string | null }> {
  const targetDate = dashDate(dataYmd)
  const bwibbu = await readLatest<Array<Record<string, string>>>(dataYmd, 'BWIBBU_ALL', BWIBBU_ALL_URL)
  const revenue = await readLatest<Array<Record<string, string>>>(dataYmd, 'T187AP05_L', T187AP05_URL)
  const company = await readLatest<Array<Record<string, string>>>(dataYmd, 'T187AP03_L', T187AP03_URL)
  // 獲利能力（0.6.5）。同樣是 whole-market 大檔、走 chip_raw_cache，
  // 所以一天 32 輪只有第一輪真的去抓。季更資料，多數輪次抽出來的值與昨天相同。
  const profit = await readLatest<Array<Record<string, string>>>(dataYmd, 'T187AP17_L', T187AP17_URL)
  // 估值檔自帶民國日期（例：'1150724'）。記進 batch_run_log 才回答得出
  // 「基本面什麼時候更新」—— 原本只記 synced 計數，而那個數字會被「新增股票」干擾。
  const bwibbuDate = bwibbu?.[0]?.Date ?? null
  // 全部失敗才整段跳過。只要有一份抓到就照常寫檔 ——
  // buildFundamentalFile 會保留既有欄位，不會把沒抓到的部分覆寫成空殼。
  if (!bwibbu && !revenue && !company && !profit) return { synced: 0, bwibbuDate }

  let synced = 0
  for (const { ticker, name } of tickers) {
    try {
      const existing = await downloadJson<FundamentalFile>(`fundamental/${ticker}.json`)
      if (existing && existing.schema === FUNDAMENTAL_SCHEMA && existing.dataDate >= targetDate) {
        continue
      }

      const valuation = extractValuation(bwibbu, ticker)
      const latestRevenue = extractRevenue(revenue, ticker)
      const latestProfit = extractProfit(profit, ticker)
      const industry = extractIndustry(revenue, company, ticker)

      // 欄位組裝與註記判斷都在 twFundamental.ts 的純函式裡（那裡測得到）
      const file = buildFundamentalFile({
        ticker,
        name,
        dataDate: targetDate,
        asOf: new Date().toISOString(),
        existing,
        valuation,
        latestRevenue,
        latestProfit,
        industry,
        bwibbuLoaded: bwibbu !== null,
      })
      if (await uploadJson(`fundamental/${ticker}.json`, file)) synced++
    } catch {
      // 單檔失敗不影響其他檔，也不影響已寫好的籌碼報告
    }
  }
  return { synced, bwibbuDate }
}

// ---- 月營收歷史回補（MOPS t21sc03）----

/**
 * 抓 big5 網頁。MOPS 的 t21sc03 是 big5，直接當 UTF-8 讀會整份變亂碼。
 * 失敗（含 10 秒逾時）回 null 不拋，比照 syncNews 的容錯準則。
 */
async function fetchBig5Text(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return new TextDecoder('big5').decode(await res.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * 把 fundamental/{ticker}.json 的 revenueMonths 補到最近 REVENUE_MONTHS_CAP 個已公布月份。
 *
 * **為什麼需要它**：每晚的 syncFundamental 只拿得到最新一個月（t187ap05_L 端點不吃年月），
 * 所以新標的第一個月只有 1 筆、要整整一年才長滿。這裡改由 MOPS 的分月報表把缺口一次補起來。
 *
 * 設計上的三個決定：
 * 1. **缺口驅動**。先讀所有目標檔算出還缺哪些月份，全滿就直接回，一個對外請求都不發 ——
 *    與 decideSkip 的短路同一個精神。補齊之後每晚都是零成本。
 * 2. **不寫 chip_raw_cache**。pruneChipCache 是 `ymd < cutoff`（8 碼日期）的字典序比較，
 *    任何月份鍵（'2026-06'）都比它小，**每輪都會被刪掉**，快取等於白寫。
 *    fundamental/*.json 本身就是快取：某個月補進所有檔之後就再也不會被請求。
 * 3. **每個月抓上市＋上櫃兩份**。代號在兩份之間不重疊（實測 991 / 860 家），
 *    合成一張表就不必去判斷某檔是上市還是上櫃 —— 而我們的 transactions 裡本來就沒存這件事。
 */
async function backfillRevenue(
  tickers: Array<{ ticker: string; name: string }>,
  now: Date,
): Promise<{ filled: number; months: string[] }> {
  if (tickers.length === 0) return { filled: 0, months: [] }

  const wantMonths = publishedMonths(now, REVENUE_MONTHS_CAP)

  // 先讀一輪算出缺口。順便把檔案留著，省得補完再下載一次。
  const files = new Map<string, FundamentalFile>()
  const have = new Map<string, RevenueProgress>()
  for (const { ticker } of tickers) {
    const file = await downloadJson<FundamentalFile>(`fundamental/${ticker}.json`)
    // 檔案還沒產生就先跳過：syncFundamental 會在同一輪稍早建立它，下一輪再補
    if (!file) continue
    files.set(ticker, file)
    have.set(ticker, {
      months: new Set((file.revenueMonths ?? []).map((m) => m.yearMonth)),
      through: file.revenueBackfilledThrough ?? null,
    })
  }

  const targets = planRevenueBackfill(have, wantMonths, MAX_BACKFILL_MONTHS)
  if (targets.length === 0) return { filled: 0, months: [] }
  const wanted = new Set(files.keys())

  // month → (ticker → RevenueMonth)
  const fetched = new Map<string, Map<string, RevenueMonth>>()
  // 「這個月份我們確實去看過了」。判準是**抓取成功**，不是「有找到我們要的代號」——
  // 全是 ETF 時 merged 必然是空的，用有無資料判斷會讓 through 永遠推不動、回補卡死。
  const attempted: string[] = []
  for (const ym of targets) {
    const merged = new Map<string, RevenueMonth>()
    let ok = false
    for (const market of MOPS_MARKETS) {
      const url = mopsRevenueUrl(market, ym)
      if (!url) continue
      const html = await fetchBig5Text(url)
      if (!html) continue
      ok = true
      for (const [ticker, row] of parseMopsRevenue(html, ym, wanted)) merged.set(ticker, row)
    }
    if (ok) attempted.push(ym)
    if (merged.size > 0) fetched.set(ym, merged)
  }
  // 一個月都沒抓成功（對方掛了 / 網路不通）就什麼都別改，下一輪重試
  if (attempted.length === 0) return { filled: 0, months: [] }

  let filled = 0
  for (const [ticker, file] of files) {
    const incoming: RevenueMonth[] = []
    for (const byTicker of fetched.values()) {
      const row = byTicker.get(ticker)
      if (row) incoming.push(row)
    }

    // fillGapsOnly：既有值一律保留。t187ap05_L 抓到的是更正後的數字，
    // 不能被一份較舊的 MOPS 爬取蓋掉（見 mergeRevenueMonths 的說明）。
    const merged = mergeRevenueMonths(file.revenueMonths, incoming, { fillGapsOnly: true })
    // ⚠️ 比月份清單而不是比長度：已有 12 筆的檔補進一個新月份時，cap 會砍掉最舊的一筆，
    // 長度仍是 12 但內容變了 —— 用長度判斷會把這次真正的更新當成沒事發生而不寫檔。
    const before = (file.revenueMonths ?? []).map((m) => m.yearMonth).join(',')
    const monthsChanged = merged.map((m) => m.yearMonth).join(',') !== before

    // 進度也要寫回去，**即使一筆資料都沒找到** —— ETF 正是靠這個收斂，
    // 否則它每輪都會把同樣的月份重新列為缺口。
    const through = nextBackfilledThrough(file.revenueBackfilledThrough, attempted)
    if (!monthsChanged && through === (file.revenueBackfilledThrough ?? null)) continue

    const next: FundamentalFile = {
      ...file,
      revenueMonths: merged,
      revenueBackfilledThrough: through,
      asOf: new Date().toISOString(),
    }
    if (await uploadJson(`fundamental/${ticker}.json`, next)) filled++
  }
  return { filled, months: [...fetched.keys()].sort() }
}

// ---- 新聞（AI 分析的消息面）----

/** ISO 時刻對應的台北日曆日 YYYY-MM-DD（UTC+8 固定偏移，台灣無日光節約） */
function taipeiDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 每檔台股以股票名稱查 Google News RSS，產出 news/{ticker}.json（整份覆寫）。
 * 同一台北日曆日已抓過就跳過（新聞一天一抓即可；cron 一天三班，頭班抓、後兩班跳過）。
 * fetch 失敗或解析出 0 則時**不覆寫既有檔**——留舊新聞比空檔有用。
 */
async function syncNews(tickers: Array<{ ticker: string; name: string }>): Promise<number> {
  const today = taipeiDateOf(new Date().toISOString())
  let synced = 0
  for (const { ticker, name } of tickers) {
    try {
      const existing = await downloadJson<NewsFile>(`news/${ticker}.json`)
      if (existing && existing.schema === NEWS_SCHEMA && taipeiDateOf(existing.asOf) === today) {
        continue
      }

      const url = googleNewsRssUrl(name, ticker)
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) continue
      const items = parseGoogleNewsRss(await res.text())
      if (items.length === 0) continue

      const file: NewsFile = {
        schema: NEWS_SCHEMA,
        ticker,
        name,
        asOf: new Date().toISOString(),
        query: `${name} ${ticker}`,
        items,
      }
      if (await uploadJson(`news/${ticker}.json`, file)) synced++
    } catch {
      // 單檔失敗（含 10 秒逾時）不影響其他檔與主流程
    }
  }
  return synced
}

// ---- 美國總經指標（0.6.5）----

/**
 * 產出 `macro/us.json`：五個 FRED 序列的最新值與近 12 期走勢。
 *
 * **這是本專案第一份非個股資料**，幾個刻意的決定：
 *
 * 1. **單一全域檔，不是 per-ticker**。全市場共用，每檔股票看到的完全一樣；
 *    寫成 per-ticker 只是把同一份資料抄 N 遍。形狀最接近 `manifest.json`。
 * 2. **不進 `tickers` 迴圈、不進 `warmStock`**。它與個股無關，
 *    掛進去只會讓「新增一檔股票」誤觸五次對外請求。
 * 3. **跳過條件用台北日曆日，不用 `dataYmd`**（比照 `syncNews`）。
 *    美國數據按自己的發布日走，與台股交易日無關；用交易日當鍵會在連假期間停更。
 * 4. **不寫 `chip_raw_cache`**。那張表的 prune 是 `ymd < cutoff` 的 8 碼日期字典序，
 *    月份鍵每輪都會被刪掉（`backfillRevenue` 就是為此不用它）。
 *    `macro/us.json` 自己就是快取 —— 一天只抓一次。
 * 5. **全部失敗就不覆寫既有檔**，沿用 `syncNews` 的準則：留舊資料勝過空檔。
 */
async function syncMacro(
  now: Date,
): Promise<{ synced: boolean; count: number; asOf: string | null }> {
  const today = taipeiDateOf(now.toISOString())
  const existing = await downloadJson<MacroFile>('macro/us.json')
  if (existing && existing.schema === MACRO_SCHEMA && taipeiDateOf(existing.asOf) === today) {
    // 今天已經抓過。count 用既有的指標數，才分得出「跳過」與「抓不到」
    return { synced: false, count: existing.indicators?.length ?? 0, asOf: existing.asOf }
  }

  const since = fredSinceDate(now, MACRO_LOOKBACK_MONTHS)
  const indicators: MacroIndicator[] = []
  for (const spec of FRED_SERIES) {
    try {
      const res = await fetch(fredCsvUrl(spec.id, since), {
        // ⚠️ 不是 twChips 的 UA。送瀏覽器字串會被 FRED 直接重置連線，見 MACRO_UA
        headers: { 'User-Agent': MACRO_UA, Accept: 'text/csv' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) continue
      const ind = deriveIndicator(spec, parseFredCsv(await res.text()))
      // 一期都算不出來（序列停更或格式改了）就別放進檔案，讓前端顯示缺料
      if (ind.latest) indicators.push(ind)
    } catch {
      // 單一序列失敗不影響其他四個
    }
  }
  // 全滅時不覆寫既有檔（沿用 syncNews 的準則：留舊資料勝過空檔）。
  // 回傳 count = 0 讓 batch_run_log 記得下來 —— 這裡曾經整批失敗而只剩
  // 一個 boolean false 可看，查不出是「跳過」還是「抓不到」。
  if (indicators.length === 0) return { synced: false, count: 0, asOf: existing?.asOf ?? null }

  const file: MacroFile = {
    schema: MACRO_SCHEMA,
    asOf: now.toISOString(),
    region: '美國',
    indicators,
  }
  const ok = await uploadJson('macro/us.json', file)
  return {
    synced: ok,
    count: indicators.length,
    asOf: ok ? file.asOf : (existing?.asOf ?? null),
  }
}

/**
 * 抓台幣對主要 8 種外幣的匯率，寫入 `fx/twd.json`（全域單檔）。
 *
 * 結構與 `syncMacro` 逐條對應（台北日冪等、單一失敗不影響其他、全滅不覆寫），
 * 只有兩點是匯率獨有的：
 *
 * 1. **每個幣別要試兩個方向的幣對**。Yahoo 有一側是「回 200、結構完整、
 *    但只有一格資料」，而且哪一側是死的因幣別而異（實測 CNYTWD=X 與 TWDEUR=X
 *    都只回一格，方向還相反）。故以 `FX_MIN_POINTS` 判定夠不夠，不夠就換下一個候選。
 *    詳見 fxRates.ts 的 FxSpec.symbols 註解。
 * 2. **成功就跳出候選迴圈**，正常情況下每個幣別只發一次請求，八個幣別八次。
 */
async function syncFx(now: Date): Promise<{ synced: boolean; count: number; asOf: string | null }> {
  const today = taipeiDateOf(now.toISOString())
  const existing = await downloadJson<FxFile>('fx/twd.json')
  if (existing && existing.schema === FX_SCHEMA && taipeiDateOf(existing.asOf) === today) {
    // 今天已經抓過。count 用既有的幣別數，才分得出「跳過」與「抓不到」
    return { synced: false, count: existing.currencies?.length ?? 0, asOf: existing.asOf }
  }

  const currencies: FxCurrency[] = []
  for (const spec of FX_CURRENCIES) {
    for (const cand of spec.symbols) {
      try {
        // 沿用抓 Yahoo 日線的同一個 helper（帶 UA、非 200 拋錯）——
        // Yahoo 吃瀏覽器 UA，與 FRED 那種「不能宣稱是瀏覽器」相反，別搞混
        const resp = await fetchJson<ChartResponse>(fxUrl(cand.symbol))
        const points = extractFxPoints(resp, cand.invert)
        // 點數不足代表這一側是死的（只回當下報價），換下一個候選幣對
        if (points.length < FX_MIN_POINTS) continue
        currencies.push(buildCurrency(spec, cand.symbol, points))
        break
      } catch {
        // 單一候選失敗就試下一個；八個幣別彼此獨立
      }
    }
  }

  // 全滅時不覆寫既有檔（沿用 syncMacro / syncNews 的準則：留舊資料勝過空檔）。
  // 回傳 count = 0 讓 batch_run_log 分得出「跳過」與「抓不到」
  if (currencies.length === 0) return { synced: false, count: 0, asOf: existing?.asOf ?? null }

  const file: FxFile = {
    schema: FX_SCHEMA,
    asOf: now.toISOString(),
    base: 'TWD',
    currencies,
  }
  const ok = await uploadJson('fx/twd.json', file)
  return {
    synced: ok,
    count: currencies.length,
    asOf: ok ? file.asOf : (existing?.asOf ?? null),
  }
}

/** 刪除 reports bucket 中資料日早於 cutoff 的整個 {ymd}/ 目錄 */
async function pruneStorage(cutoffYmd: string): Promise<void> {
  try {
    const { data: entries } = await db.storage.from(REPORTS_BUCKET).list('', { limit: 1000 })
    for (const e of entries ?? []) {
      if (!/^\d{8}$/.test(e.name) || e.name >= cutoffYmd) continue
      const { data: files } = await db.storage.from(REPORTS_BUCKET).list(e.name, { limit: 1000 })
      const paths = (files ?? []).map((f) => `${e.name}/${f.name}`)
      if (paths.length > 0) await db.storage.from(REPORTS_BUCKET).remove(paths)
    }
  } catch {
    // 清理失敗不影響主流程
  }
}

async function pruneChipCache(cutoffYmd: string): Promise<void> {
  try {
    await db.from('chip_raw_cache').delete().lt('ymd', cutoffYmd)
  } catch {
    // 清理失敗不影響主流程
  }
}

/**
 * 即點即產要用的交易日：以 `manifest.json` 的 ymd 為準，跟夜間批次同一個基準。
 * 沒有 manifest（批次從未跑過）時退而取最近的非週末日。
 */
async function warmDataYmd(): Promise<string> {
  const m = await downloadJson<{ ymd?: unknown }>('manifest.json')
  if (m && typeof m.ymd === 'string' && /^\d{8}$/.test(m.ymd)) return m.ymd
  const candidates = tradingDateCandidates(new Date())
  return candidates.find((y) => !isWeekendYmd(y)) ?? candidates[0] ?? ''
}

/**
 * 單一代號的即點即產：補上日線與基本面（0.6.0-dev.7）。
 *
 * 為什麼需要它：新加入的股票要等下一班夜間批次才有日線與基本面，
 * 在那之前技術面與基本面分頁是空的，AI 分析甚至會因為拿不到日線而整個失敗。
 *
 * 為什麼安全（0.3.9 燒掉額度的教訓）：
 * 1. 沿用 `heldTwTickers()` 白名單，非持股一律 403 —— 與 `generate` 同一道防線。
 * 2. 兩者都與批次共用「已是最新就跳過」的條件，且**查無資料也會寫檔**，
 *    所以同一檔每天最多只會真的做一次事，之後前端直接讀 Storage。
 * 3. 基本面那三份是全市場大檔且走 `chip_raw_cache`，對外放大效應趨近於零。
 *
 * 刻意**不**含新聞：它只服務 AI 分析，而 AI 在缺新聞時本來就能正常降級
 * （prompt 有缺料文案），沒必要為它在開頁路徑上多付一次 10 秒逾時的 RSS 請求。
 */
async function handleWarm(body: GenerateReportRequestBody): Promise<Response> {
  const ticker = String(body.ticker ?? '').trim()
  if (!TICKER_RE.test(ticker)) {
    return json({ error: 'ticker 格式不正確' }, 400)
  }

  const held = await heldTwTickers()
  const entry = held.find((h) => h.ticker === ticker)
  if (!entry) {
    return json({ error: '此代號不在持股清單內，無法產生資料' }, 403)
  }

  const dataYmd = await warmDataYmd()
  if (!dataYmd) return json({ error: '無法判斷交易日' }, 503)

  const one = [{ ticker, name: entry.name }]
  const dailySynced = await syncDaily(one, dataYmd, { onDemand: true })
  const fundamental = await syncFundamental(one, dataYmd)

  return json({
    ok: true,
    ticker,
    ymd: dataYmd,
    dailySynced,
    fundamentalSynced: fundamental.synced,
  })
}

/**
 * 台北時間 HH:MM。存進 batch_run_log 是為了「一眼看得出這是哪一班」，
 * 免得每次查都要自己把 UTC 轉時區。
 */
function taipeiHhmm(d: Date): string {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`
}

/**
 * 記錄一次批次執行。寫入失敗完全不影響主流程 —— 這是觀測資料，不是產出。
 *
 * 存在的理由見 schema.sql §7：pg_net 的回應只留 6 小時、chip_raw_cache 只記成功時間，
 * 兩者都答不出「那一班跑的時候當天資料到了沒」，而那正是微調 cron 時段唯一需要的事實。
 */
async function logBatchRun(row: Record<string, unknown>): Promise<void> {
  try {
    await db.from('batch_run_log').insert(row)
  } catch {
    // 觀測失敗不能拖垮批次
  }
}

// ---- 資料源探針（0.6.3）----

/**
 * 每輪對外看一眼「各來源現在自己宣告是哪一天的」，寫進 `source_probe_log`。
 *
 * **為什麼要獨立一條路徑，而不是在批次裡順便記**：
 * `batch_run_log.bwibbu_date` 看起來像在記這件事，其實記的是**快取值** ——
 * `readLatest` 用「我們去抓的那天」當快取鍵，當天第一輪抓完就整天吃快取。
 * 2026-07-27 那 12 輪全記成同一個 `1150724`，**那不是 12 次觀測，是同一次被讀了 12 遍**；
 * 而且批次一短路就完全不記（當晚 23:00 起三輪空白）。用它來判斷「幾點更新」會得到假答案。
 *
 * 探針刻意**不寫快取、不寫 Storage、不碰批次的任何狀態**：它只回答
 * 「這個時刻，這個來源說自己是哪一天的、內容有沒有變」。
 * 批次那三道閘門（含「短路＝零對外請求」）因此完全不受影響，仍然可證。
 *
 * 只探 `BWIBBU_ALL`（116KB，每日）與借券 `TWT96U`（244KB）—— 這兩個是目前唯二
 * 「有快取就整天不再看」的來源。T86 與融資融券已由 `batch_run_log` 的
 * `t86_revisions` / `margin_today` 如實記錄，不必重複探。
 * 月營收與公司資料是月更新，15 分鐘探一次沒有意義。
 *
 * 要停掉：`SELECT cron.unschedule('source-probe');` —— 不必重新部署。
 */
async function probeOne<T>(
  url: string,
  ok: (v: T) => boolean,
  dateOf: (v: T) => string | null,
  rowsOf: (v: T) => unknown,
): Promise<{ ok: boolean; date: string | null; fp: string | null; rows: number | null }> {
  try {
    const resp = await fetchJson<T>(url)
    if (!ok(resp)) return { ok: false, date: null, fp: null, rows: null }
    const rows = rowsOf(resp)
    return {
      ok: true,
      date: dateOf(resp),
      fp: rowsFingerprint(rows),
      rows: Array.isArray(rows) ? rows.length : null,
    }
  } catch {
    return { ok: false, date: null, fp: null, rows: null }
  }
}

async function handleProbe(): Promise<Response> {
  const startedAt = Date.now()
  const now = new Date()

  // 兩個來源互不相干，併發探；任一失敗只讓自己那組欄位為 null
  const [bwibbu, borrow] = await Promise.all([
    probeOne<Array<Record<string, string>>>(
      BWIBBU_ALL_URL,
      (v) => Array.isArray(v) && v.length > 0,
      (v) => v[0]?.Date ?? null, // 民國 7 碼，例 '1150724'
      (v) => v,
    ),
    probeOne<BorrowDatedResponse>(
      BORROW_DATED_URL,
      borrowDatedOk,
      borrowDatedDate, // rwd 版 title 自帶的日期（＝下一個交易日）
      (v) => v.data ?? [],
    ),
  ])

  const row = {
    taipei_ymd: taipeiYmd(now),
    taipei_time: taipeiHhmm(now),
    bwibbu_ok: bwibbu.ok,
    bwibbu_date: bwibbu.date,
    bwibbu_fp: bwibbu.fp,
    bwibbu_rows: bwibbu.rows,
    borrow_ok: borrow.ok,
    borrow_date: borrow.date,
    borrow_fp: borrow.fp,
    borrow_rows: borrow.rows,
    duration_ms: Date.now() - startedAt,
  }
  try {
    await db.from('source_probe_log').insert(row)
  } catch {
    // 觀測失敗不能拖垮任何東西；探針本來就只是儀器
  }
  return json({ ok: true, ...row })
}

/** 今天最後一次執行留下的狀態；查無（第一次跑、或表不存在）回 null */
interface LastRun {
  runsToday: number
  t86: T86State | null
  runSig: string | null
}

/**
 * 從 `batch_run_log` today 的最後一列取回跨輪次狀態。
 *
 * **為什麼把狀態放在觀測表**：這些欄位本來就是我們想觀測的東西（改寫幾次、什麼時候定稿），
 * 沒必要為同一份資料再建一張表。代價是它變成半承載狀態的 —— 寫入失敗時
 * （`logBatchRun` 刻意吞例外）下一輪會當成當天第一次跑，於是重抓一次 T86 並重新計數。
 * 那是**多做事**而不是做錯事，可以接受；但別把這個特性忘了。
 */
async function readLastRun(todayYmd: string): Promise<LastRun | null> {
  try {
    const { data, error } = await db
      .from('batch_run_log')
      .select('runs_today, t86_fingerprint, t86_revisions, t86_unchanged, t86_frozen, run_sig')
      .eq('taipei_ymd', todayYmd)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const fp = data.t86_fingerprint
    return {
      runsToday: Number(data.runs_today ?? 0),
      t86:
        typeof fp === 'string' && fp
          ? {
              fingerprint: fp,
              revisions: Number(data.t86_revisions ?? 0),
              unchanged: Number(data.t86_unchanged ?? 0),
              frozen: Boolean(data.t86_frozen),
            }
          : null,
      runSig: typeof data.run_sig === 'string' ? data.run_sig : null,
    }
  } catch {
    return null
  }
}

/**
 * 盤後批次（0.6.1 起改為 16:00–23:45 每 15 分鐘輪詢，取代原本的三班制）。
 *
 * 三件事讓「一天跑 32 次」不會變成一天做 32 次白工：
 * 1. **短路**：今天該有的都有了就直接回，一個對外請求都不發（`decideSkip`）。
 * 2. **改寫偵測**：T86 定稿前每輪重抓比對，定稿後才凍結（`nextT86State`）。
 *    這是必要的 —— T86 自 16:00 起每 15 分鐘更新，早抓到的不一定是定稿。
 * 3. **重產閘門**：輸入沒變就不重寫報告，讓 `generatedAt` 只在真有變動時才跳。
 *
 * 判斷邏輯全部抽在 `pollPlan.ts` 並有測試釘住 —— 這裡只負責接線。
 * 理由見該檔開頭：判斷寫錯的代價從三班時代的 3 倍變成 32 倍。
 */
async function handleGenerateAll(): Promise<Response> {
  const startedAt = Date.now()
  const now = new Date()
  const todayYmd = taipeiYmd(now)
  t86FingerprintByYmd.clear()

  // ---- 短路判定：必須在任何對外請求之前 ----
  const last = await readLastRun(todayYmd)
  const cachedToday = await cachedDayDatasets([todayYmd])
  const skip = decideSkip({
    t86Today: cachedToday.has(`${todayYmd}:T86`),
    t86Frozen: last?.t86?.frozen ?? false,
    marginToday: cachedToday.has(`${todayYmd}:MI_MARGN_D`),
    runsToday: last?.runsToday ?? 0,
  })
  if (skip.skip) {
    await logBatchRun({
      taipei_ymd: todayYmd,
      taipei_time: taipeiHhmm(now),
      runs_today: (last?.runsToday ?? 0) + 1,
      skipped: true,
      skip_reason: skip.reason,
      t86_today: cachedToday.has(`${todayYmd}:T86`),
      t86_fingerprint: last?.t86?.fingerprint ?? null,
      t86_revisions: last?.t86?.revisions ?? 0,
      t86_unchanged: last?.t86?.unchanged ?? 0,
      t86_frozen: last?.t86?.frozen ?? false,
      run_sig: last?.runSig ?? null,
      duration_ms: Date.now() - startedAt,
    })
    return json({ ok: true, skipped: true, reason: skip.reason, ymd: todayYmd })
  }

  const tickers = await heldTwTickers()
  // 今天的 T86 已有快取但尚未定稿 → 重抓比對；還沒有的話走原本的抓取路徑即可
  const refreshT86Ymd =
    cachedToday.has(`${todayYmd}:T86`) && !(last?.t86?.frozen ?? false) ? todayYmd : undefined
  const series = await loadSeries(
    tickers.map((t) => t.ticker),
    now,
    { refreshT86Ymd },
  )
  const marginFallbackRows = await loadMarginFallback(
    series.dataYmd,
    series.marginDatedFailed || series.days.length === 0,
  )
  const borrow = await loadBorrow(todayYmd)

  // 這一輪跑完之後，今天的融資融券到了沒。必須重讀 —— `cachedToday` 是短路判定用的
  // 「執行前」快照，若今天的融資融券正好是這一輪抓到的，用它會晚一輪才記到。
  // 也不能用 `margin_ok`（＝ `!marginDatedFailed`）代替：那個旗標問的是「有沒有任何一天
  // 抓成功」，不是「今天的到了沒」。2026-07-27 17:46 正式區實測就是這個形狀 ——
  // `margin_ok=true` 但今天的 MI_MARGN_D 根本還沒發布（那時只有 20260724 那份）。
  const cachedAfter = await cachedDayDatasets([todayYmd])

  // T86 改寫狀態：只有抓到「今天」的資料時才推進 ——
  // 資料日還停在前一個交易日時，今天的那份根本還沒發布，沒有定稿可言。
  const t86Today = series.dataYmd === todayYmd
  const t86Fp = t86FingerprintByYmd.get(todayYmd) ?? ''
  const t86State = t86Today && t86Fp ? nextT86State(last?.t86 ?? null, t86Fp) : null

  const sig = runSignature({
    dataYmd: series.dataYmd,
    t86: t86Fp,
    margin: series.marginDatedFailed ? '' : series.dataYmd,
    borrow: borrow.date ?? '',
    tickers: tickers.map((t) => t.ticker),
  })
  const regenerate = sig !== last?.runSig

  let generated = 0
  if (regenerate) {
    for (const { ticker, name } of tickers) {
      const data = assembleOne({ ticker, name, holding: null, series, marginFallbackRows, borrow })
      const okUp = await uploadJson(`${series.dataYmd}/${ticker}.json`, {
        ticker,
        dataDate: data.dataDate,
        generatedAt: data.generatedAt,
        data,
      })
      if (okUp) generated++
    }

    // 讓前端知道「最近一份」是哪個交易日，免在前端重算交易日
    await uploadJson('manifest.json', {
      ymd: series.dataYmd,
      dataDate: dashDate(series.dataYmd),
      generatedAt: new Date().toISOString(),
    })
  }

  // 技術面的日線；與籌碼報告各自獨立，抓不到也不影響上面已寫好的報告
  const dailySynced = await syncDaily(tickers, series.dataYmd)

  // 基本面與新聞（0.6.0-dev.4）；同樣各自獨立、單檔容錯，不拖垮主流程
  const fundamental = await syncFundamental(tickers, series.dataYmd)
  // 月營收歷史回補（0.6.4）。必須排在 syncFundamental 之後 —— 它讀的是剛寫好的檔案。
  // 12 個月補滿之後這行是零成本的（缺口為空就直接回，不發任何對外請求）。
  const revenue = await backfillRevenue(tickers, now)
  const newsSynced = await syncNews(tickers)

  // 清掉過期的報告與原始檔快取；兩者保留期不同，原因見常數定義處。
  // daily/ fundamental/ news/ 不受影響：pruneStorage 只認 ^\d{8}$ 的目錄名，
  // 而這三類都是覆寫制、本來就沒有舊檔要清。
  // 只在有重產時才清 —— 沒重產就沒有新東西進來，沒有要清的。
  if (regenerate) {
    await pruneStorage(ymdMinusDays(series.dataYmd, REPORT_RETAIN_DAYS))
    await pruneChipCache(ymdMinusDays(series.dataYmd, CACHE_RETAIN_DAYS))
  }

  // 觀測紀錄：t86_today 回答「這一輪跑的時候，當天的個股三大法人到了沒」；
  // 各源的 *_data_* 欄位回答「它自己宣告是哪一天的」—— 端點都不給 Last-Modified，
  // 這是唯一能記下來的時間事實（2026-07-27 實測，見 PROGRESS.md）。
  await logBatchRun({
    taipei_ymd: todayYmd,
    taipei_time: taipeiHhmm(now),
    runs_today: (last?.runsToday ?? 0) + 1,
    skipped: false,
    skip_reason: null,
    data_ymd: series.dataYmd,
    t86_today: t86Today,
    t86_fingerprint: t86State?.fingerprint ?? null,
    t86_revisions: t86State?.revisions ?? 0,
    t86_unchanged: t86State?.unchanged ?? 0,
    t86_frozen: t86State?.frozen ?? false,
    margin_ok: !series.marginDatedFailed,
    margin_today: cachedAfter.has(`${todayYmd}:MI_MARGN_D`),
    borrow_ok: borrow.resp !== null,
    borrow_data_date: borrow.date,
    bwibbu_date: fundamental.bwibbuDate,
    run_sig: sig,
    regenerated: regenerate,
    history_days: series.days.length,
    generated,
    daily_synced: dailySynced,
    fundamental_synced: fundamental.synced,
    revenue_backfilled: revenue.filled,
    news_synced: newsSynced,
    duration_ms: Date.now() - startedAt,
  })

  return json({
    ok: true,
    ymd: series.dataYmd,
    generated,
    regenerated: regenerate,
    total: tickers.length,
    historyDays: series.days.length,
    dailySynced,
    fundamentalSynced: fundamental.synced,
    revenueBackfilled: revenue.filled,
    revenueMonths: revenue.months,
    newsSynced,
    t86Today,
    t86Revisions: t86State?.revisions ?? 0,
    t86Frozen: t86State?.frozen ?? false,
  })
}

/**
 * 手動催一次月營收回補。不碰籌碼報告、不寫 batch_run_log ——
 * 那張表的每一列代表「一輪盤後批次」，塞進手動操作會汙染「幾點資料到齊」的判讀。
 * 單次上限是 MAX_BACKFILL_MONTHS 個月，`months` 回報這次實際補了哪幾個月；
 * 回空陣列就代表已經補滿、不必再跑。
 */
async function handleBackfillRevenue(): Promise<Response> {
  const startedAt = Date.now()
  const tickers = await heldTwTickers()
  const revenue = await backfillRevenue(tickers, new Date())
  return json({
    ok: true,
    total: tickers.length,
    filled: revenue.filled,
    months: revenue.months,
    monthsPerRun: MAX_BACKFILL_MONTHS,
    durationMs: Date.now() - startedAt,
  })
}

/**
 * 手動或排程觸發總經同步。
 *
 * 0.6.5-dev.2 從 `generate-all` 拆出來，理由是**觸發時機**而不是程式碼位置：
 * 盤後批次的 cron 是台股作息（每 15 分鐘、UTC 8-15 時、週一至週五），
 * 而美國數據跟台股交易日無關 —— 週末完全不跑。
 * 更直接的是 `handleGenerateAll` 的 `decideSkip` 短路會在資料到齊後直接 return，
 * 排在它後面的東西整段不會執行。
 *
 * 拆的是 cron job 不是函式：`source-probe` 已有「同一支函式、不同 action、
 * 不同排程」的先例，多開一支 Edge Function 只是多一個要部署與稽核的對象。
 */
async function handleSyncMacro(): Promise<Response> {
  const startedAt = Date.now()
  const macro = await syncMacro(new Date())
  return json({
    ok: true,
    synced: macro.synced,
    count: macro.count,
    asOf: macro.asOf,
    durationMs: Date.now() - startedAt,
  })
}

/** 手動或排程觸發匯率同步。拆排程的理由同 handleSyncMacro（見上），由 `fx-daily` 觸發 */
async function handleSyncFx(): Promise<Response> {
  const startedAt = Date.now()
  const fx = await syncFx(new Date())
  return json({
    ok: true,
    synced: fx.synced,
    count: fx.count,
    asOf: fx.asOf,
    durationMs: Date.now() - startedAt,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  let body: GenerateReportRequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  if (body.action === 'generate') {
    return handleGenerate(body)
  }

  if (body.action === 'warm') {
    return handleWarm(body)
  }

  if (body.action === 'generate-all') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleGenerateAll()
  }

  // 月營收歷史回補：會寫 Storage 且會對 MOPS 發請求，把關同 generate-all。
  // 夜間批次本來就會順手跑，這個入口是給「不想等排程、現在就要補滿」用的。
  if (body.action === 'backfill-revenue') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleBackfillRevenue()
  }

  // 總經同步：會寫 Storage 且對 FRED 發請求，把關同 generate-all。
  // 由獨立的 cron job `macro-daily` 觸發（每天兩班，見 schema.sql）
  if (body.action === 'sync-macro') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleSyncMacro()
  }

  // 匯率同步：會寫 Storage 且對 Yahoo 發請求，把關同 generate-all。
  // 由獨立的 cron job `fx-daily` 觸發（每天兩班，見 schema.sql §10）
  if (body.action === 'sync-fx') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleSyncFx()
  }

  // 資料源探針：只讀不寫（除了自己的觀測表），但仍走 CRON_SECRET ——
  // 它會對 TWSE 發請求，公開端點不設防等於送人一個代打工具
  if (body.action === 'probe') {
    const denied = assertCronSecret(req)
    if (denied) return denied
    return handleProbe()
  }

  return json({ error: 'Unknown action' }, 400)
})
