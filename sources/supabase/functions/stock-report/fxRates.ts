/**
 * 台幣對主要外幣的匯率抓取與解析（Yahoo Finance chart 端點）。
 *
 * **為什麼不是台灣銀行牌告匯率**（0.6.7 規劃時實測，2026-07-29）：
 * `https://rate.bot.com.tw/xrt/flcsv/0/day` 與
 * `https://rate.bot.com.tw/xrt/flcsv/0/{YYYY-MM}/{幣別}` 兩個 CSV 端點
 * 都回 `<title>Challenge Validation</title>` 的 JS proof-of-work 人機驗證頁，
 * 換成瀏覽器 UA 也一樣（與 FRED 那種「UA 挑食」不同層級 —— 這個要真的執行 JS
 * 才過得了，Deno Edge Function 做不到）。
 *
 * 代價要說清楚：**因此拿不到「現金／即期、買入／賣出」四個牌告價，只有市場中價。**
 * 畫面上必須標示「非銀行牌告匯率，實際結匯請以往來銀行為準」，不可略過。
 *
 * 改用 Yahoo 的理由是它本來就在專案裡：twDaily.ts 抓台股日線用的是同一支 API、
 * 同樣的 `interval=1d&range=1y`，連 `ChartResponse` 型別與 `tradingDateOf()` 都直接沿用。
 *
 * 解析為純函式、不觸網，比照 twDaily.ts / usMacro.ts 的分工。
 */

import { type ChartResponse, tradingDateOf } from './twDaily.ts'

/**
 * fx/twd.json 的結構版本。前端守門必須用 `>=`（見 src/services/fxProxy.ts）——
 * 加欄位對舊前端是無害的加法，用等號會在後端升版時讓整個分頁當場全掛。
 */
export const FX_SCHEMA = 1

/**
 * 一天的匯率。tuple 是為了壓 Storage 體積（沿用 twDaily.DailyRow 的理由：
 * 物件陣列約為 tuple 的 3 倍大）。8 個幣別 × 260 天，物件寫法會逼近 150KB。
 *
 * `rate` 一律是「**1 單位外幣可換多少台幣**」。反向（1 台幣換多少外幣）由前端取倒數，
 * 不另存一份 —— 兩份會走鐘。
 */
export type FxPoint = [date: string, rate: number]

export interface FxSpec {
  /** ISO 4217 代號 */
  code: string
  name: string
  /**
   * 畫面顯示的小數位數。各幣別量級差很多：USD 32.387 用 3 位就夠，
   * KRW 0.022289 用 3 位會變成 0.022、看不出任何變化。
   */
  decimals: number
  /**
   * Yahoo 幣對候選，**依序嘗試**。`invert` 為 true 代表該幣對報的是
   * 「1 台幣換多少外幣」，要取倒數才是我們要存的方向。
   *
   * ⚠️ **為什麼需要兩個候選、而不是統一用某一個方向**（2026-07-29 實測 8 個幣別）：
   * 兩個方向都各有幣別是死的，而且死的方式一模一樣 —— 回 200、結構完整、
   * 但 `timestamp` 只有 1 格（僅當下報價，沒有任何歷史）：
   *
   *   `CNYTWD=X` → 1 格 ❌ ／ `TWDCNY=X` → 263 格 ✅
   *   `TWDEUR=X` → 1 格 ❌ ／ `EURTWD=X` → 263 格 ✅
   *
   * 沒有任何單一方向對八個幣別都成立。這種「安靜地只回一格」不會拋錯、
   * 不會有非 200 狀態碼，只會讓走勢圖變成一個點 —— 所以判定條件是
   * **點數是否足夠**（見 FX_MIN_POINTS），不是請求成不成功。
   *
   * 候選順序是實測當下較有資料的那一側，第二個純粹是保險：
   * 哪一側有流動性是 Yahoo 自己的事，將來對調了 fallback 會自動接上。
   */
  symbols: readonly { symbol: string; invert: boolean }[]
}

/** 主要 8 種幣別。順序即畫面順序 */
export const FX_CURRENCIES: readonly FxSpec[] = [
  { code: 'USD', name: '美元', decimals: 3, symbols: pair('USD') },
  { code: 'JPY', name: '日圓', decimals: 4, symbols: pair('JPY') },
  { code: 'EUR', name: '歐元', decimals: 3, symbols: pair('EUR') },
  // 實測 CNYTWD=X 只回一格，故把台幣在前的那一側排第一
  { code: 'CNY', name: '人民幣', decimals: 4, symbols: pairReversed('CNY') },
  { code: 'HKD', name: '港幣', decimals: 4, symbols: pair('HKD') },
  { code: 'GBP', name: '英鎊', decimals: 3, symbols: pair('GBP') },
  { code: 'AUD', name: '澳幣', decimals: 3, symbols: pair('AUD') },
  { code: 'KRW', name: '韓元', decimals: 5, symbols: pair('KRW') },
]

/** 外幣在前（`USDTWD=X` 直接就是 1 外幣 = N 台幣），台幣在前的那側當備援 */
function pair(code: string): readonly { symbol: string; invert: boolean }[] {
  return [
    { symbol: `${code}TWD=X`, invert: false },
    { symbol: `TWD${code}=X`, invert: true },
  ]
}

/** 順序相反的版本，給實測上「外幣在前那側是死的」幣別用 */
function pairReversed(code: string): readonly { symbol: string; invert: boolean }[] {
  return [
    { symbol: `TWD${code}=X`, invert: true },
    { symbol: `${code}TWD=X`, invert: false },
  ]
}

/**
 * 判定「這個幣對算不算有歷史」的門檻。
 *
 * 一年的日線實測是 260 個交易日；死掉的那一側是 1 格。60 這個值取在兩者之間、
 * 且剛好是三個月的交易日數 —— 低於它連最短的 3 個月走勢圖都畫不出來，
 * 那就該去試下一個候選幣對。
 */
export const FX_MIN_POINTS = 60

/** 一年份，與 twDaily 同一組參數 */
export function fxUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * 存進 Storage 的精度。六位小數對每個幣別都夠：
 * 最小的 KRW 是 0.022289，六位小數仍保有四位有效數字。
 * 不做這一步的話 Yahoo 原始值長這樣：0.19965200126171112（單檔會多出將近一倍體積）。
 */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/**
 * 由 chart 回應抽出「1 外幣 = N 台幣」的日序列（由舊到新）。
 * 結構不符或無有效資料時回空陣列，呼叫端據此改試下一個候選幣對。
 *
 * 三個實測到的處理（2026-07-29，八個幣對各打一次）：
 *
 * 1. **收盤為 null 的格要丟掉**：實測每個幣對都有 3 格，是耶誕節、元旦，
 *    以及「當天的日線還沒收」。同 twDaily 的 extractDaily。
 *
 * 2. **timestamp 要先加 `meta.gmtoffset` 再取 UTC 日期**。匯率的時區是**倫敦**
 *    （gmtoffset=3600、timezone=BST），而且原始秒數指向 23:00Z ——
 *    直接 `toISOString().slice(0,10)` 會整條序列**倒退一天**。
 *    twDaily 的註解說「台股時區碰巧會對」，匯率這裡連碰巧都沒有。
 *
 * 3. **要剔除 Yahoo 附加在序列尾端的「即時報價列」**，它不是日線收盤。
 *
 *    實測每個幣對的 timestamp 末端長這樣：
 *      …, 1785193200 (23:00:00Z), 1785279600 (23:00:00Z), 1785289523 (01:45:23Z)
 *    前面每一格都落在當地午夜（BST 時是 23:00Z），只有最後一格是抓取當下的秒數，
 *    而且它**精確等於 `meta.regularMarketTime`** —— 兩個幣對各驗一次都成立，
 *    所以判定是確定性的，不必去猜時間對齊。
 *
 *    **為什麼一定要剔除**（2026-07-29 實測，這是真的會顯示錯誤數字的 bug）：
 *    反向幣對（TWD 在前）那一側流動性差，即時報價與它自己的日線序列對不起來。
 *    人民幣當天的日線是 4.7766，附加的即時列換算後是 4.9900 —— 日變動 **+4.47%**，
 *    而同一天其他七個幣別都只動 0.4%。掛在畫面上就是一個一望即知的錯誤。
 *
 *    代價是 `latest` 變成「最後一根完整日線」而非當下報價。這與這頁本來的承諾
 *    （「每日更新兩次、非即時報價」）一致，反而更誠實。
 *
 * 保留 Map 覆寫（同日以最後一筆為準）是防禦：剔除即時列之後理論上不會再有重覆日，
 * 但真的重覆時取新的那筆才對。
 */
export function extractFxPoints(resp: ChartResponse, invert: boolean): FxPoint[] {
  const result = resp?.chart?.result?.[0]
  const ts = result?.timestamp
  const q = result?.indicators?.quote?.[0]
  if (!Array.isArray(ts) || !q) return []

  const offset = num(result?.meta?.gmtoffset) ?? 0
  const liveAt = num(result?.meta?.regularMarketTime)
  const byDate = new Map<string, number>()
  for (let i = 0; i < ts.length; i++) {
    // 即時報價列：不是日線收盤，且反向幣對那側的值不可信（見上方 3.）
    if (liveAt !== null && ts[i] === liveAt) continue
    const close = num(q.close?.[i])
    if (close === null) continue
    // 取倒數前必須排除 0：Yahoo 沒回過 0，但 1/0 會是 Infinity 而後續全部計算跟著壞掉
    if (invert && close === 0) continue
    byDate.set(tradingDateOf(ts[i], offset), round6(invert ? 1 / close : close))
  }

  return [...byDate.entries()]
    .map(([date, rate]): FxPoint => [date, rate])
    .sort((a, b) => a[0].localeCompare(b[0]))
}

export interface FxCurrency {
  code: string
  name: string
  decimals: number
  /** 實際採用的 Yahoo 幣對，供稽核用（哪一側有資料會隨時間變） */
  symbol: string
  /** 最新一筆匯率（1 外幣 = N 台幣）。無資料時為 null */
  latest: number | null
  /** 前一個交易日，用來算日變動 */
  prevClose: number | null
  /** 由舊到新，一年份 */
  points: FxPoint[]
}

/** Storage 內 fx/twd.json 的結構。**全域單檔，不是 per-ticker**（同 macro/us.json） */
export interface FxFile {
  schema: number
  /** 我們實際產出它的時間 ISO */
  asOf: string
  base: 'TWD'
  currencies: FxCurrency[]
}

/** 由抓到的序列組出一個幣別的完整結構 */
export function buildCurrency(spec: FxSpec, symbol: string, points: FxPoint[]): FxCurrency {
  return {
    code: spec.code,
    name: spec.name,
    decimals: spec.decimals,
    symbol,
    latest: points[points.length - 1]?.[1] ?? null,
    prevClose: points[points.length - 2]?.[1] ?? null,
    points,
  }
}
