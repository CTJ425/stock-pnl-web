/**
 * 月營收「歷史月份」抓取與解析（公開資訊觀測站 t21sc03）。
 *
 * 為什麼需要這一支：現行的 `openapi.twse.com.tw/v1/opendata/t187ap05_L`（見 twFundamental.ts）
 * **只回最新一個月，端點不吃年月參數**。原本的設計是讓 fundamental/{ticker}.json 每月自累積
 * （mergeRevenueMonths），代價是新標的第一個月只有 1 筆、要一整年才長滿 12 筆。
 * 這支模組補上「指定年月抓回全市場那一個月」的能力，讓缺口可以一次補齊。
 *
 * 資料來源（實測確認 2026-07-28）：
 *   https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_{民國年}_{月}_0.html   上市 ~450KB
 *   https://mopsov.twse.com.tw/nas/t21/otc/t21sc03_{民國年}_{月}_0.html   上櫃 ~390KB
 *
 * 實測踩到的三個陷阱，改動前務必看過：
 *  1. **host 是 `mopsov` 不是 `mops`**。`mops.twse.com.tw` 的同一條路徑已回 404。
 *  2. **編碼是 big5**，不是 UTF-8（HTML 內的 meta 有寫）。抓取端要用
 *     `new TextDecoder('big5')` 解，直接當 UTF-8 讀會整份變亂碼。
 *  3. **年增率那格的 tag 是大寫 `<Td nowrap>`**（上市上櫃皆然，疑似產表程式的手誤）。
 *     cell 比對一律大小寫不敏感，否則會少抓一欄、後面全部位移。
 *
 * 版面（上市與上櫃完全相同，實測 991 / 860 家、代號全為 4 碼且兩邊不重疊）：
 *   <tr align=right><td align=center>2330</td><td align=left>台積電</td>
 *     <td>當月營收</td><td>上月營收</td><td>去年當月營收</td>
 *     <td>上月比較增減(%)</td><Td>去年同月增減(%)</td>
 *     <td>當月累計營收</td><td>去年累計營收</td><td>前期比較增減(%)</td>
 *     <td>備註</td></tr>
 * 各產業別的「合計」列用的是 `<th …>合計</th>` 而非 `<td>`，
 * 以「第一格必須是 4 碼數字」為條件即自然排除，毋需另外偵測。
 *
 * 解析為純函式、不觸網，比照 twChips.ts / twFundamental.ts 的分工（HTTP 在 index.ts）。
 */

import { normNum } from './twChips.ts'
import type { RevenueMonth } from './twFundamental.ts'

/** ⚠️ 是 mopsov 不是 mops，見檔頭陷阱 1 */
export const MOPS_HOST = 'https://mopsov.twse.com.tw'

/** t21sc03 分上市 / 上櫃兩份，版面相同、代號不重疊 */
export type MopsMarket = 'sii' | 'otc'

export const MOPS_MARKETS: readonly MopsMarket[] = ['sii', 'otc']

/**
 * 'YYYY-MM' → t21sc03 網址。
 * 民國年 = 西元 − 1911；**月份不補零**（實測 1 月是 `t21sc03_115_1_0.html`，不是 `115_01`）。
 * 年月格式不符回 null，讓呼叫端當作「這個月不存在」跳過，而不是去抓一個必然 404 的網址。
 */
export function mopsRevenueUrl(market: MopsMarket, yearMonth: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(yearMonth ?? '').trim())
  if (!m) return null
  const rocYear = Number(m[1]) - 1911
  const month = Number(m[2])
  if (rocYear < 1 || month < 1 || month > 12) return null
  return `${MOPS_HOST}/nas/t21/${market}/t21sc03_${rocYear}_${month}_0.html`
}

/** 一列的 cell 內容（去標籤、去 &nbsp;、trim） */
function cellsOf(row: string): string[] {
  const out: string[] = []
  // tag 名 td/th 一律大小寫不敏感 —— 見檔頭陷阱 3
  const re = /<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(row)) !== null) {
    out.push(
      m[2]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .trim(),
    )
  }
  return out
}

/** 代號格式：t21sc03 的公司代號實測全部是 4 碼數字 */
const MOPS_CODE_RE = /^\d{4}$/

/**
 * 單月 t21sc03 HTML → Map<公司代號, RevenueMonth>。
 *
 * 只取 `wanted` 集合內的代號 —— 全市場近 1900 家，為了 5 檔持股全解析是白費 CPU，
 * 而 Edge Function 的 CPU 額度正是本流程最緊的一條線。
 * 傳入空集合等同「一檔都不要」，會回空 Map（不是「全要」）。
 */
export function parseMopsRevenue(
  html: string,
  yearMonth: string,
  wanted: Set<string>,
): Map<string, RevenueMonth> {
  const found = new Map<string, RevenueMonth>()
  if (!html || wanted.size === 0) return found

  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let row: RegExpExecArray | null
  while ((row = rowRe.exec(html)) !== null) {
    const cells = cellsOf(row[1])
    // 資料列固定 11 格；產業別標題列與「合計」列格數或首格都對不上
    if (cells.length < 10) continue
    const code = cells[0]
    if (!MOPS_CODE_RE.test(code)) continue
    if (!wanted.has(code) || found.has(code)) continue

    found.set(code, {
      yearMonth,
      // normNum 已處理千分位逗號，且備註常見的 '-' 會落到 Number.isFinite false → null
      revenueThousandTwd: normNum(cells[2]),
      momPercent: normNum(cells[5]),
      yoyPercent: normNum(cells[6]),
      cumulativeYoyPercent: normNum(cells[9]),
    })
  }
  return found
}

/**
 * 這一輪要去抓哪幾個月。
 *
 * 抽成純函式是因為它是整條回補路徑上唯一有判斷的地方（其餘都是 fetch / upload 的膠水），
 * 而 index.ts 綁死 Deno 與 Supabase client、在本專案的測試環境裡跑不起來。
 *
 * @param have      每檔已有的月份集合（key 是代號，值是該檔的 yearMonth 集合）
 * @param wantMonths 目標月份（publishedMonths 的輸出）
 * @param maxMonths 單次上限，見 index.ts MAX_BACKFILL_MONTHS
 * @returns 由新到舊；空陣列代表已補滿，呼叫端應直接短路、不發任何對外請求
 */
export function planRevenueBackfill(
  have: Map<string, Set<string>>,
  wantMonths: string[],
  maxMonths: number,
): string[] {
  if (have.size === 0 || maxMonths <= 0) return []
  const missing = new Set<string>()
  for (const months of have.values()) {
    for (const ym of wantMonths) if (!months.has(ym)) missing.add(ym)
  }
  // 由新到舊補：預算用完時，留下的缺口是最舊的那幾個月，對使用者的價值最低
  return [...missing].sort().reverse().slice(0, maxMonths)
}

/**
 * 由「現在」往回數 count 個**已公布**的月份，新到舊。
 *
 * 月營收依規定於次月 10 日前公布，故當月 10 日前只保證看得到上上個月的數字。
 * 抓一個還沒公布的月份得到的是 404 或空表 —— 不會壞，但每輪都白跑一次對外請求，
 * 所以寧可保守一格。
 */
export function publishedMonths(now: Date, count: number): string[] {
  // 台北時間（UTC+8 固定偏移，台灣無日光節約），與 taipeiYmd 的作法一致
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const year = taipei.getUTCFullYear()
  const month = taipei.getUTCMonth() + 1 // 1-12
  const day = taipei.getUTCDate()

  // 最新一個「已公布」的月份：10 日之後是上個月，10 日之前是上上個月
  let offset = day >= 10 ? 1 : 2
  const out: string[] = []
  for (let i = 0; i < count; i++, offset++) {
    const total = year * 12 + (month - 1) - offset
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    out.push(`${y}-${String(m).padStart(2, '0')}`)
  }
  return out
}
