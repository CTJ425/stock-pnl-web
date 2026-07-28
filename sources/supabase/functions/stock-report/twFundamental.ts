/**
 * TWSE 基本面（估值 + 月營收 + 產業別）抓取與解析。
 *
 * 資料來源（實測確認 2026-07-27，皆為 whole-market 大檔、無 date 參數，依代號篩單股）：
 * - 估值三指標：OpenAPI `exchangeReport/BWIBBU_ALL`
 *   英文鍵 { Date, Code, Name, PEratio, DividendYield, PBratio }，Date 為民國 7 碼（'1150724'）。
 *   虧損股 PEratio 為 '' 或 '-'（normNum 已處理成 null）。
 * - 月營收：OpenAPI `opendata/t187ap05_L`
 *   中文鍵；「資料年月」為民國 5 碼（'11506'）；營收單位是**千元**、增減率是 %；
 *   「產業別」直接給中文名稱（'半導體業'）。
 * - 公司基本資料：OpenAPI `opendata/t187ap03_L`
 *   「產業別」是**兩位數代碼**（'24'），需查 INDUSTRY_NAMES 對照表。
 *
 * 產業別來源順位：t187ap05_L 的中文名稱（免維護）→ t187ap03_L 代碼查表 → 原始代碼。
 *
 * 單位陷阱：月營收千元、殖利率與增減率 %。欄位名一律帶單位
 * （revenueThousandTwd / yoyPercent），沿用 twChips「不讓單位離開欄位」的準則。
 *
 * 解析函式皆為純函式、不觸網，便於單元測試；HTTP 抓取與快取在 index.ts 組合。
 * 上櫃 (TPEx) 不在這三份檔內，查無時由呼叫端寫入缺料註記。
 */

import { normNum } from './twChips.ts'

export const BWIBBU_ALL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'
export const T187AP05_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'
export const T187AP03_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
/**
 * 營益分析查詢彙總表（0.6.5 起）。中文鍵、民國年、只回**最新一季**、上市限定，
 * 與 t187ap05_L 同一族。實測 2026-07-28：1051 筆、383KB。
 *
 * 選它而不是綜合損益表 `t187ap06_L_ci`：**比率是官方算好的**
 * （毛利率 / 營業利益率 / 稅前純益率 / 稅後純益率），不必自己解析五張產業別損益表
 * 再做除法。PLAN.md §N2 當初以「欄位解析繁瑣」否決季報，那條理由在這個端點上不成立。
 */
export const T187AP17_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap17_L'

/**
 * 基本面檔的結構版本。
 * 前端守門必須用 `>=` 比對（見 src/services/fundamentalProxy.ts）——
 * 加欄位對舊前端是無害的加法，用等號會在後端升版時讓整個分頁當場全掛（0.4.1 事故）。
 *
 * 2 = 0.6.5 新增 `profitQuarters`（獲利能力比率）。
 */
export const FUNDAMENTAL_SCHEMA = 2

/** TWSE 上市產業別代碼 → 中文名稱（t187ap03_L 用；t187ap05_L 直接給名稱不需查表） */
export const INDUSTRY_NAMES: Record<string, string> = {
  '01': '水泥工業',
  '02': '食品工業',
  '03': '塑膠工業',
  '04': '紡織纖維',
  '05': '電機機械',
  '06': '電器電纜',
  '08': '玻璃陶瓷',
  '09': '造紙工業',
  '10': '鋼鐵工業',
  '11': '橡膠工業',
  '12': '汽車工業',
  '14': '建材營造',
  '15': '航運業',
  '16': '觀光餐旅',
  '17': '金融保險',
  '18': '貿易百貨',
  '19': '綜合',
  '20': '其他',
  '21': '化學工業',
  '22': '生技醫療',
  '23': '油電燃氣',
  '24': '半導體業',
  '25': '電腦及週邊設備業',
  '26': '光電業',
  '27': '通信網路業',
  '28': '電子零組件業',
  '29': '電子通路業',
  '30': '資訊服務業',
  '31': '其他電子業',
}

/** 估值三指標。任一缺值以 null 表示（不以 0 冒充），虧損股本益比即為 null */
export interface ValuationChip {
  peRatio: number | null
  dividendYieldPercent: number | null
  pbRatio: number | null
  /** BWIBBU 檔的資料日 YYYY-MM-DD；解析失敗為 null */
  dataDate: string | null
}

/** 一個月份的營收。單位寫進欄位名：金額千元、增減率 % */
export interface RevenueMonth {
  /** 'YYYY-MM' */
  yearMonth: string
  revenueThousandTwd: number | null
  momPercent: number | null
  yoyPercent: number | null
  cumulativeYoyPercent: number | null
}

/**
 * 一季的獲利能力比率。單位一律寫進欄位名（沿用 twChips「不讓單位離開欄位」的準則）。
 *
 * 命名對照 t187ap17_L 的中文欄位，以及使用者慣用的講法：
 *   毛利率     → grossMarginPercent      「毛利率(%)」
 *   營益率     → operatingMarginPercent  「營業利益率(%)」
 *   淨利率     → pretaxMarginPercent     「稅前純益率(%)」
 *   稅後淨利率 → netMarginPercent        「稅後純益率(%)」
 * 「淨利率」在台灣的口語同時指稅前與稅後，故兩個都留、名字寫死稅前 / 稅後，
 * 不用「淨利率」這種會被誤讀的字眼當欄位名。
 */
export interface ProfitQuarter {
  /** 'YYYY-Qn' */
  yearQuarter: string
  revenueMillionTwd: number | null
  grossMarginPercent: number | null
  operatingMarginPercent: number | null
  pretaxMarginPercent: number | null
  netMarginPercent: number | null
}

/** Storage 內 fundamental/{ticker}.json 的結構 */
export interface FundamentalFile {
  schema: number
  ticker: string
  name: string
  /** 我們實際產出它的時間 ISO */
  asOf: string
  /** 本次批次的交易日 YYYY-MM-DD；批次據此判斷要不要重寫 */
  dataDate: string
  industry: string | null
  valuation: ValuationChip | null
  revenueUnit: '千元'
  /** 由舊到新，最多 12 個月（覆寫制檔案內自累積） */
  revenueMonths: RevenueMonth[]
  /**
   * 歷史回補「已經找到哪個月份為止」（最舊的**已嘗試**月份 'YYYY-MM'）。
   *
   * 存在的理由是要分辨兩種 `revenueMonths` 缺月：**還沒去找** vs **找過了就是沒有**。
   * 沒有這一欄的話，ETF（不在 t21sc03 內，永遠填不滿）會把缺口清單
   * 永遠釘在最新那幾個月，真正的公司就再也拿不到更舊的資料 —— 0.6.4-dev.1
   * 部署到測試區後實測到的死結，見 PROGRESS.md。
   *
   * 舊檔沒有這一欄（undefined）代表從未回補過，視同全部未嘗試。
   */
  revenueBackfilledThrough?: string | null
  /** 獲利能力比率的單位。與 revenueUnit 同款：單位不離開資料 */
  profitUnit?: '%'
  /**
   * 由舊到新，最多 8 季（＝兩年）。與 revenueMonths 同為「覆寫制檔案內自累積」。
   *
   * t187ap17_L 只回最新一季，所以這個序列要兩年才長滿 —— 與月營收當初一樣的處境。
   * 月營收後來靠 MOPS 分月報表回補（見 twRevenueHistory.ts），
   * 但季度版是 AJAX POST（實測靜態網址 404），0.6.5 不做回補。
   * 舊檔沒有這一欄（undefined）視同空陣列。
   */
  profitQuarters?: ProfitQuarter[]
  notes: string[]
}

/** 民國 7 碼日期 '1150724' → '2026-07-24'；格式不符回 null */
export function rocDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!/^\d{7}$/.test(s)) return null
  const year = Number(s.slice(0, 3)) + 1911
  return `${year}-${s.slice(3, 5)}-${s.slice(5, 7)}`
}

/** 民國 5 碼年月 '11506' → '2026-06'；格式不符回 null */
export function rocYearMonth(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!/^\d{5}$/.test(s)) return null
  const year = Number(s.slice(0, 3)) + 1911
  return `${year}-${s.slice(3, 5)}`
}

/**
 * 民國年 + 季別 → 'YYYY-Qn'。例：`'115'` + `'1'` → `'2026-Q1'`。
 * 兩者任一格式不符回 null（季別只接受 1–4）。
 */
export function rocYearQuarter(year: unknown, quarter: unknown): string | null {
  const y = String(year ?? '').trim()
  const q = String(quarter ?? '').trim()
  if (!/^\d{2,3}$/.test(y) || !/^[1-4]$/.test(q)) return null
  return `${Number(y) + 1911}-Q${q}`
}

/** 由 BWIBBU_ALL 取單一代號的估值。查無回 null */
export function extractValuation(
  rows: Array<Record<string, string>> | null,
  ticker: string,
): ValuationChip | null {
  const row = (rows ?? []).find((r) => String(r.Code ?? '').trim() === ticker)
  if (!row) return null
  return {
    peRatio: normNum(row.PEratio),
    dividendYieldPercent: normNum(row.DividendYield),
    pbRatio: normNum(row.PBratio),
    dataDate: rocDate(row.Date),
  }
}

/** 由 t187ap05_L 取單一代號的最新月營收。查無或年月解析失敗回 null */
export function extractRevenue(
  rows: Array<Record<string, string>> | null,
  ticker: string,
): RevenueMonth | null {
  const row = (rows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  if (!row) return null
  const yearMonth = rocYearMonth(row['資料年月'])
  if (!yearMonth) return null
  return {
    yearMonth,
    revenueThousandTwd: normNum(row['營業收入-當月營收']),
    momPercent: normNum(row['營業收入-上月比較增減(%)']),
    yoyPercent: normNum(row['營業收入-去年同月增減(%)']),
    cumulativeYoyPercent: normNum(row['累計營業收入-前期比較增減(%)']),
  }
}

/**
 * 由 t187ap17_L 取單一代號的最新一季獲利能力。查無或年季解析失敗回 null。
 *
 * 欄位名帶著括號說明（例：`毛利率(%)(營業毛利)/(營業收入)`），是端點的原樣，
 * 不要「順手整理」—— 那是查表的鍵，改了就查不到。
 */
export function extractProfit(
  rows: Array<Record<string, string>> | null,
  ticker: string,
): ProfitQuarter | null {
  const row = (rows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  if (!row) return null
  const yearQuarter = rocYearQuarter(row['年度'], row['季別'])
  if (!yearQuarter) return null
  return {
    yearQuarter,
    revenueMillionTwd: normNum(row['營業收入(百萬元)']),
    grossMarginPercent: normNum(row['毛利率(%)(營業毛利)/(營業收入)']),
    operatingMarginPercent: normNum(row['營業利益率(%)(營業利益)/(營業收入)']),
    pretaxMarginPercent: normNum(row['稅前純益率(%)(稅前純益)/(營業收入)']),
    netMarginPercent: normNum(row['稅後純益率(%)(稅後純益)/(營業收入)']),
  }
}

/**
 * 產業別：t187ap05_L 中文名稱優先，退 t187ap03_L 代碼查表，再退原始代碼。
 * 兩份都查無（上櫃股）回 null。
 */
export function extractIndustry(
  revenueRows: Array<Record<string, string>> | null,
  companyRows: Array<Record<string, string>> | null,
  ticker: string,
): string | null {
  const revRow = (revenueRows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  const revName = String(revRow?.['產業別'] ?? '').trim()
  if (revName) return revName

  const compRow = (companyRows ?? []).find((r) => String(r['公司代號'] ?? '').trim() === ticker)
  const code = String(compRow?.['產業別'] ?? '').trim()
  if (!code) return null
  return INDUSTRY_NAMES[code] ?? code
}

/** revenueMonths 上限。12 個月足以看出年增趨勢，也控住 payload 大小 */
export const REVENUE_MONTHS_CAP = 12

/**
 * 組出要寫進 Storage 的 fundamental/{ticker}.json。
 *
 * 抽成純函式的理由是實際踩到的：這裡是**整份重建**物件，
 * 0.6.4-dev.2 新增 `revenueBackfilledThrough` 時漏了帶過去，
 * 等於每個交易日的第一輪批次都把回補進度抹掉、隔天再重走 12 個月。
 * 那個 bug 在 index.ts 裡看不出來 —— 它既不在 `tsc -b` 的涵蓋範圍
 * （只收 src/），也沒有任何測試碰得到。所以有判斷、有欄位組裝的部分放這裡。
 *
 * @param bwibbuLoaded 估值大檔這輪**有沒有載到**（不是「這檔有沒有估值」）。
 *   兩者都會讓 valuation 為 null，但只有前者為 true 時才能斷定「這檔不在涵蓋範圍」。
 */
export function buildFundamentalFile(args: {
  ticker: string
  name: string
  dataDate: string
  asOf: string
  existing: FundamentalFile | null | undefined
  valuation: ValuationChip | null
  latestRevenue: RevenueMonth | null
  latestProfit: ProfitQuarter | null
  industry: string | null
  bwibbuLoaded: boolean
}): FundamentalFile {
  const { ticker, name, dataDate, asOf, existing, valuation, latestRevenue, industry } = args

  // 註記分項，見 PLAN.md N6。**既有的資料量要算進來** ——
  // 上櫃股回補後有營收但仍無估值，不能再套用「查無公司基本面資料」那條。
  // 0.6.5 起獲利能力同理：這輪沒抓到不代表這檔從來沒有。
  const hasAnyHistory =
    (existing?.revenueMonths?.length ?? 0) > 0 || (existing?.profitQuarters?.length ?? 0) > 0
  const notes: string[] = []
  if (!valuation && !latestRevenue && !args.latestProfit && !industry && !hasAnyHistory) {
    // ETF 與上櫃股都不在這三份 TWSE 檔內（實測 0050 三份皆查無）。
    notes.push('查無公司基本面資料：ETF 與上櫃（TPEx）標的不在 TWSE 這三份資料中')
  } else if (!valuation && args.bwibbuLoaded) {
    notes.push('無估值資料：本益比等三項只涵蓋上市（TWSE）個股')
  }

  return {
    schema: FUNDAMENTAL_SCHEMA,
    ticker,
    name,
    asOf,
    dataDate,
    industry,
    valuation,
    revenueUnit: '千元',
    revenueMonths: mergeRevenueMonths(
      existing?.revenueMonths,
      latestRevenue ? [latestRevenue] : [],
    ),
    // ⚠️ 整份重建時每個「不由本次輸入決定」的欄位都必須明確帶過去，
    //    漏掉就是無聲的資料遺失。這一欄漏過一次，見上方說明。
    revenueBackfilledThrough: existing?.revenueBackfilledThrough ?? null,
    profitUnit: '%',
    profitQuarters: mergeProfitQuarters(
      existing?.profitQuarters,
      args.latestProfit ? [args.latestProfit] : [],
    ),
    notes,
  }
}

/**
 * 把新的月份併入既有序列：依 yearMonth 去重、由舊到新排序、cap 12。
 * 覆寫制檔案靠這個在每晚重寫時自累積月營收史（首月 1 筆，逐月長到 12 筆）。
 *
 * `fillGapsOnly` 決定同月份撞在一起時誰贏，兩種呼叫端的需求剛好相反：
 * - **每晚的最新月份**（t187ap05_L，index.ts syncFundamental）用預設的覆寫。
 *   月營收會更正重發，後抓的才是對的。
 * - **歷史回補**（MOPS t21sc03，index.ts backfillRevenue）要 `fillGapsOnly: true`。
 *   回補是「補缺口」，若讓它覆寫，一份較舊的爬取結果就會把 t187ap05_L 抓到的
 *   更正後數字蓋掉 —— 補歷史反而弄髒現況，是最不划算的交換。
 */
export function mergeRevenueMonths(
  prev: RevenueMonth[] | null | undefined,
  incoming: RevenueMonth[] | null | undefined,
  opts: { fillGapsOnly?: boolean } = {},
): RevenueMonth[] {
  return mergePeriodSeries(prev, incoming, (m) => m.yearMonth, REVENUE_MONTHS_CAP, opts)
}

/** profitQuarters 上限。8 季＝兩年，足以看出趨勢，也控住 payload 大小 */
export const PROFIT_QUARTERS_CAP = 8

/**
 * 把新的一季併入既有序列。語意與 `mergeRevenueMonths` 完全相同，
 * 只是鍵換成 `yearQuarter`、上限換成 8。
 *
 * 目前只有「每季覆寫」一種呼叫端（沒有歷史回補），但 `fillGapsOnly` 仍然保留 ——
 * 季度回補只是還沒做，不是不會做（t187ap17_L 同樣只回最新一季）。
 */
export function mergeProfitQuarters(
  prev: ProfitQuarter[] | null | undefined,
  incoming: ProfitQuarter[] | null | undefined,
  opts: { fillGapsOnly?: boolean } = {},
): ProfitQuarter[] {
  return mergePeriodSeries(prev, incoming, (q) => q.yearQuarter, PROFIT_QUARTERS_CAP, opts)
}

/**
 * 上面兩支的共用核心：依期別鍵去重、由舊到新排序、砍到 cap。
 *
 * 抽出來是因為兩者的規則必須永遠一致 —— 各寫一份的話，
 * 哪天只修好其中一邊（例如只在月營收那邊補了「壞資料不混進結果」）
 * 就會變成兩套行為，而這種不一致從呼叫端完全看不出來。
 *
 * 期別鍵都是可字典序比較的字串（`'2026-06'` / `'2026-Q1'`），故直接用字串比大小。
 */
function mergePeriodSeries<T>(
  prev: T[] | null | undefined,
  incoming: T[] | null | undefined,
  keyOf: (item: T) => unknown,
  cap: number,
  opts: { fillGapsOnly?: boolean },
): T[] {
  const byKey = new Map<string, T>()
  const put = (item: T, skipExisting: boolean) => {
    if (!item) return
    const key = keyOf(item)
    if (typeof key !== 'string' || !key) return
    if (skipExisting && byKey.has(key)) return
    byKey.set(key, item)
  }
  for (const item of prev ?? []) put(item, false)
  for (const item of incoming ?? []) put(item, opts.fillGapsOnly === true)
  return [...byKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, item]) => item)
    .slice(-cap)
}
