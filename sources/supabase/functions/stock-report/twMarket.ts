/**
 * 台股**全市場**每日量能與三大法人買賣金額（0.6.28）。
 *
 * 與 twChips 的差別是「範圍」不是「內容」：那支是單一個股的籌碼，這支是整個集中市場的
 * 總量。兩者不可混用 —— 個股買賣超的單位是**股**，全市場的單位是**元**（金額）。
 * 欄位名一律帶單位，沿用專案準則。
 *
 * 兩個來源，取捨理由不同：
 *
 * 1. **成交量值**：`FMTQIK`（rwd 版）帶 `date=YYYYMM01` 會回**整個月的每日列**，
 *    所以歷史一次一個月就補得完。OpenAPI 版只回最新一天，補歷史要等好幾個月，故不用。
 * 2. **三大法人買賣金額**：`BFI82U` 只有「單日」才是逐日資料（`type=month` 回的是整月合計，
 *    不是每日）。所以它**一天一個請求**，得像個股籌碼那樣用預算式回補，不能一次抓完。
 *
 * 兩者的日期覆蓋範圍因此不一致：成交量值會先到，法人買賣超逐日補上 ——
 * `MarketDay.institutional` 為 null 就是「這天還沒補到」，不是「這天沒有法人進出」。
 */

/** 保留幾個交易日。約半年，夠看趨勢又不讓單檔 JSON 過大（每日一列約 200 bytes） */
export const MARKET_DAYS_CAP = 120

/** 三大法人**買賣差額**，單位一律元。正為買超、負為賣超 */
export interface MarketInstitutional {
  /** 外資及陸資（不含外資自營商） */
  foreignTwd: number | null
  foreignDealerTwd: number | null
  trustTwd: number | null
  /** 自營商（自行買賣） */
  dealerSelfTwd: number | null
  /** 自營商（避險） */
  dealerHedgeTwd: number | null
  /** 官方揭露的合計。**不由前五項相加得來**，直接取端點的值 */
  totalTwd: number | null
}

export interface MarketDay {
  /** 'YYYY-MM-DD' */
  date: string
  tradeVolumeShares: number | null
  tradeValueTwd: number | null
  transactions: number | null
  /** 發行量加權股價指數（收盤） */
  taiex: number | null
  /** 漲跌點數 */
  changePoints: number | null
  /**
   * 加權指數的開高低（0.6.30，畫大盤日 K 用）。
   *
   * **來源與收盤價不同支**：FMTQIK 只有收盤與漲跌點數，開高低要另外向
   * `MI_5MINS_HIST` 拿。兩者都是一次一個月，故同一輪一起抓、抓完再併。
   */
  taiexOpen: number | null
  taiexHigh: number | null
  taiexLow: number | null
  /** null＝這天的法人金額還沒補到（見檔頭說明） */
  institutional: MarketInstitutional | null
}

/** Storage 內 market/daily.json 的結構 */
export interface MarketFile {
  schema: number
  /** 我們實際產出它的時間 ISO */
  asOf: string
  /** 由舊到新，最多 MARKET_DAYS_CAP 筆 */
  days: MarketDay[]
}

export const MARKET_SCHEMA = 1

/** 整月的每日成交量值。`date` 只有年月有意義，日固定給 01 */
export function fmtqikMonthUrl(yyyymm: string): string | null {
  if (!/^\d{6}$/.test(yyyymm)) return null
  return `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${yyyymm}01&response=json`
}

/** 整月的加權指數開高低收（0.6.30）。`date` 同 FMTQIK，只有年月有意義 */
export function taiexHistMonthUrl(yyyymm: string): string | null {
  if (!/^\d{6}$/.test(yyyymm)) return null
  return `https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?date=${yyyymm}01&response=json`
}

/** 單日的三大法人買賣金額。**只有 type=day 是逐日**（見檔頭） */
export function bfi82uDayUrl(ymd: string): string | null {
  if (!/^\d{8}$/.test(ymd)) return null
  return `https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate=${ymd}&type=day&response=json`
}

/** '1,234,567' → 1234567；'--' / 空字串 / 非數字 → null（不以 0 冒充缺值） */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.replace(/,/g, '').trim()
  if (!s || !/^[+-]?\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 民國 '115/08/03' → 西元 '2026-08-03'；格式不符回 null */
export function rocSlashDate(v: unknown): string | null {
  const m = String(v ?? '').match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/)
  if (!m) return null
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`
}

interface RwdTable {
  stat?: string
  fields?: string[]
  data?: unknown[][]
}

/**
 * 解析 FMTQIK 的整月回應。
 *
 * 欄位以**表頭文字**定位而不是寫死索引，理由同 twProfitHistory：
 * 端點改版時錯位比缺欄難發現得多 —— 數字還在，只是全部對到隔壁那一欄。
 */
export function parseFmtqik(json: unknown): MarketDay[] {
  const t = (json ?? {}) as RwdTable
  if (t.stat !== 'OK' || !Array.isArray(t.data) || !Array.isArray(t.fields)) return []
  const at = (name: string) => t.fields!.indexOf(name)
  const iDate = at('日期')
  const iVolume = at('成交股數')
  const iValue = at('成交金額')
  const iCount = at('成交筆數')
  const iIndex = at('發行量加權股價指數')
  const iChange = at('漲跌點數')
  if (iDate < 0) return []

  const out: MarketDay[] = []
  for (const row of t.data) {
    if (!Array.isArray(row)) continue
    const date = rocSlashDate(row[iDate])
    if (!date) continue
    out.push({
      date,
      tradeVolumeShares: iVolume < 0 ? null : num(row[iVolume]),
      tradeValueTwd: iValue < 0 ? null : num(row[iValue]),
      transactions: iCount < 0 ? null : num(row[iCount]),
      taiex: iIndex < 0 ? null : num(row[iIndex]),
      changePoints: iChange < 0 ? null : num(row[iChange]),
      taiexOpen: null,
      taiexHigh: null,
      taiexLow: null,
      institutional: null,
    })
  }
  return out
}

/**
 * 解析 MI_5MINS_HIST 的整月回應：加權指數的開高低收（0.6.30）。
 *
 * 只回 `date → 開高低`，收盤刻意不取 —— FMTQIK 那份已經有了，
 * 同一個欄位讓兩支各寫一次，總有一天會不一致而且看不出是哪一支寫的。
 */
export function parseTaiexHist(json: unknown): Map<string, { open: number | null; high: number | null; low: number | null }> {
  const out = new Map<string, { open: number | null; high: number | null; low: number | null }>()
  const t = (json ?? {}) as RwdTable
  if (t.stat !== 'OK' || !Array.isArray(t.data) || !Array.isArray(t.fields)) return out
  const iDate = t.fields.indexOf('日期')
  const iOpen = t.fields.indexOf('開盤指數')
  const iHigh = t.fields.indexOf('最高指數')
  const iLow = t.fields.indexOf('最低指數')
  if (iDate < 0) return out

  for (const row of t.data) {
    if (!Array.isArray(row)) continue
    const date = rocSlashDate(row[iDate])
    if (!date) continue
    out.set(date, {
      open: iOpen < 0 ? null : num(row[iOpen]),
      high: iHigh < 0 ? null : num(row[iHigh]),
      low: iLow < 0 ? null : num(row[iLow]),
    })
  }
  return out
}

/**
 * 解析 BFI82U 的單日回應。查無資料（非交易日）回 null。
 *
 * 以**單位名稱**對應欄位，不靠列的順序 —— 這張表的列順序在歷史上變動過
 * （自營商拆成自行買賣與避險兩列的那次），寫死索引會整組錯位而且看起來像真的。
 */
export function parseBfi82u(json: unknown): MarketInstitutional | null {
  const t = (json ?? {}) as RwdTable
  if (t.stat !== 'OK' || !Array.isArray(t.data) || !Array.isArray(t.fields)) return null
  const iName = t.fields.indexOf('單位名稱')
  const iNet = t.fields.indexOf('買賣差額')
  if (iName < 0 || iNet < 0) return null

  const byName = new Map<string, number | null>()
  for (const row of t.data) {
    if (!Array.isArray(row)) continue
    const name = String(row[iName] ?? '').trim()
    if (name) byName.set(name, num(row[iNet]))
  }
  if (byName.size === 0) return null

  const pick = (...names: string[]): number | null => {
    for (const n of names) {
      const v = byName.get(n)
      if (v !== undefined) return v
    }
    return null
  }

  return {
    foreignTwd: pick('外資及陸資(不含外資自營商)', '外資及陸資'),
    foreignDealerTwd: pick('外資自營商'),
    trustTwd: pick('投信'),
    dealerSelfTwd: pick('自營商(自行買賣)', '自營商'),
    dealerHedgeTwd: pick('自營商(避險)'),
    totalTwd: pick('合計'),
  }
}

/**
 * 併入新的日期列：依日期去重、由舊到新、砍到 cap。
 *
 * **既有值不會被「沒有那一項」的新一份蓋掉**：三份來源的覆蓋範圍本來就不同步 ——
 * 成交量值整月重抓（不帶法人、不帶開高低）、開高低另一支、法人一天一支。
 * 若整筆覆寫，補好的法人買賣超每晚都會被洗掉一次 ——
 * 與 mergeProfitQuarters 的 EPS 是同一個問題、同一個解法。
 */
export function mergeMarketDays(
  prev: MarketDay[] | null | undefined,
  incoming: MarketDay[] | null | undefined,
  cap = MARKET_DAYS_CAP,
): MarketDay[] {
  const byDate = new Map<string, MarketDay>()
  for (const d of prev ?? []) if (d?.date) byDate.set(d.date, d)
  for (const d of incoming ?? []) {
    if (!d?.date) continue
    const old = byDate.get(d.date)
    byDate.set(d.date, {
      ...d,
      taiexOpen: d.taiexOpen ?? old?.taiexOpen ?? null,
      taiexHigh: d.taiexHigh ?? old?.taiexHigh ?? null,
      taiexLow: d.taiexLow ?? old?.taiexLow ?? null,
      institutional: d.institutional ?? old?.institutional ?? null,
    })
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, d]) => d)
    .slice(-cap)
}

/**
 * 這一輪要補哪幾天的法人金額（一天一個請求，故要預算）。
 *
 * 由新到舊：預算用完時留下的缺口是最舊的那幾天，對使用者的價值最低（同回補的一貫作法）。
 * @returns 'YYYYMMDD'，可直接餵給 `bfi82uDayUrl`
 */
export function planInstitutionalBackfill(
  days: MarketDay[] | null | undefined,
  maxDays: number,
): string[] {
  if (maxDays <= 0) return []
  return (days ?? [])
    .filter((d) => d?.date && !d.institutional)
    .map((d) => d.date.replace(/-/g, ''))
    .sort()
    .reverse()
    .slice(0, maxDays)
}

/**
 * 要抓哪幾個月：本月，加上**任何還缺開高低的月份**（0.6.30）。
 *
 * 缺口驅動而不是只抓本月 —— 開高低是 0.6.30 才加的，之前存下來的日子全都沒有，
 * 而那些月份不會再被碰到，K 線就會永遠只有這個月的那幾根。
 * 與 EPS 的處境完全相同（既有資料缺一個新欄位），故用同一個解法。
 *
 * 上限 `maxMonths`：一個月一次請求 × 兩支端點，不設限的話第一輪會去打半年份。
 * 由新到舊補，補完之後這個函式每輪都只回本月，成本回到原本的樣子。
 */
export function planMarketMonths(
  now: Date,
  have: MarketDay[] | null | undefined,
  maxMonths = 3,
): string[] {
  // 台北時間的年月（批次跑在 UTC，直接用 UTC 會在月初的凌晨抓錯月份）
  const taipei = new Date(now.getTime() + 8 * 3600 * 1000)
  const y = taipei.getUTCFullYear()
  const m = taipei.getUTCMonth() + 1
  const thisMonth = `${y}${String(m).padStart(2, '0')}`

  const months = new Set<string>([thisMonth])
  // 檔案還空著時連上個月一起抓，畫面一開始就有長度
  if ((have?.length ?? 0) < 20) {
    const prev = new Date(Date.UTC(y, m - 2, 1))
    months.add(`${prev.getUTCFullYear()}${String(prev.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  for (const d of have ?? []) {
    /*
      ⚠️ 用 `== null` 而不是 `=== null`：0.6.30 之前寫下的日子**根本沒有這個欄位**，
      讀回來是 undefined 不是 null。用嚴格比較會漏掉全部舊資料 ——
      實測就是這樣：部署後 K 線只有本月那 2 根，7 月的 22 天永遠補不到。
    */
    if (d?.date && d.taiexOpen == null) months.add(d.date.slice(0, 7).replace('-', ''))
  }
  return [...months].sort().reverse().slice(0, maxMonths)
}
