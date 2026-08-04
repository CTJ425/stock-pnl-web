/**
 * 季度獲利能力的歷史回補（MOPS 綜合損益表彙總）。
 *
 * ## 為什麼需要它
 *
 * 每晚批次抓的 `t187ap17_L` 是**當季快照**，不是歷史檔 —— 實測只回 58 家、
 * 且只有一個季別（民國115 Q2）。所以 `profitQuarters` 一季只長一筆，
 * 要湊滿 12 季得等三年。這一支把過去的季度一次補起來，補完就零成本
 * （缺口為空直接回，不發任何對外請求），與月營收回補同一個精神。
 *
 * ## 資料源與陷阱（皆為實測，2026-08-04）
 *
 * `POST https://mopsov.twse.com.tw/mops/web/ajax_t163sb04`
 * body：`encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK={市場}&year={民國年}&season={01..04}`
 *
 * 1. **是 POST 不是 GET**，而且吃的是表單編碼；月營收那支 t21sc03 是靜態 GET，兩者不同。
 * 2. **編碼是 UTF-8，不是 big5。** t21sc03 是 big5（見 twRevenueHistory 檔頭），
 *    這支照 big5 解會整份變亂碼 —— 兩支放在一起維護時特別容易搞混。
 * 3. **一頁有 7 張表格、6 種產業別格式**（一般業 30 欄、金融 22/23/18 欄…），
 *    欄位位置完全不同。所以**一律以表頭文字定位欄位，不寫死索引**。
 * 4. 回應約 1.6 MB。當季剛開始申報時會小很多（實測 115 Q2 只有 104 KB），
 *    那是正常的，不是抓錯。
 *
 * ## 比率的算法與驗證
 *
 * 四項比率都是「該項 ÷ 營業收入 × 100」。**已與官方 `t187ap17_L` 對過答案**：
 * 民國115 Q1 的 1802 / 2303 / 2609 四項比率全部逐位吻合
 * （例：1802 毛 19.23 / 營 7.88 / 前 6.44 / 後 5.71）。
 *
 * ⚠️ **金融業沒有「毛利」的概念**，銀行業甚至沒有單一的「營業收入」欄
 * （它是利息淨收益＋利息以外淨損益兩欄）。找不到對應表頭的項目一律回 null，
 * 畫面顯示「—」。硬湊一個分母只會產生無法與其他產業比較的數字。
 */

import { normNum } from './twChips.ts'
import type { ProfitQuarter } from './twFundamental.ts'

export const MOPS_T163_HOST = 'https://mopsov.twse.com.tw'
export const MOPS_T163_PATH = '/mops/web/ajax_t163sb04'

export type MopsMarket = 'sii' | 'otc'
export const T163_MARKETS: readonly MopsMarket[] = ['sii', 'otc']

/**
 * 'YYYY-Qn' → POST 表單字串。年季格式不符回 null，
 * 讓呼叫端當作「這一季不存在」跳過，而不是去打一個必然失敗的請求。
 */
export function mopsProfitBody(market: MopsMarket, yearQuarter: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(yearQuarter ?? '').trim())
  if (!m) return null
  const rocYear = Number(m[1]) - 1911
  if (rocYear < 1) return null
  const season = `0${m[2]}`
  return `encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=${market}&year=${rocYear}&season=${season}`
}

/* ── 表頭對照 ──────────────────────────────────────────────
   同一個概念在不同產業別的表格裡叫不同名字，依序比對、取第一個命中的。
   順序有意義：先試最精確的名稱，再退到比較泛用的。
   ────────────────────────────────────────────────────────── */

/** 營業收入（比率的分母）。銀行業沒有單一欄位，故不列 —— 該產業整組回 null */
const H_REVENUE = ['營業收入', '淨收益', '收益', '收入']
const H_GROSS = ['營業毛利（毛損）淨額', '營業毛利（毛損）']
const H_OPERATING = ['營業利益（損失）', '營業利益']
const H_PRETAX = [
  '稅前淨利（淨損）',
  '繼續營業單位稅前淨利（淨損）',
  '繼續營業單位稅前純益（純損）',
  '繼續營業單位稅前損益',
]
const H_NET = ['本期淨利（淨損）', '本期稅後淨利（淨損）']
/**
 * 基本每股盈餘（元）。**不是比率，不除以營收** —— 它已經是每股的絕對金額。
 * 稀釋每股盈餘不取：畫面上與本益比對得起來的是基本 EPS。
 */
const H_EPS = ['基本每股盈餘（元）', '基本每股盈餘', '基本每股盈餘(元)']

/** 去標籤、去 &nbsp;、trim。tag 名大小寫不敏感（比照 twRevenueHistory 的處理） */
function cellsOf(row: string, tag: 'td' | 'th'): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(row)) !== null) {
    out.push(
      m[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .trim(),
    )
  }
  return out
}

/** 表頭清單裡找第一個命中的欄位索引；都沒有回 null（該產業沒有這個概念） */
function columnOf(headers: string[], names: readonly string[]): number | null {
  for (const n of names) {
    const i = headers.indexOf(n)
    if (i >= 0) return i
  }
  return null
}

/**
 * 解析一頁 MOPS 綜合損益表，回傳 `代號 → ProfitQuarter`。
 *
 * @param wanted 只保留這些代號；空集合代表全要（測試用）
 */
export function parseMopsProfit(
  html: string,
  yearQuarter: string,
  wanted: ReadonlySet<string>,
): Map<string, ProfitQuarter> {
  const out = new Map<string, ProfitQuarter>()
  const tables = String(html ?? '').match(/<table[^>]*>[\s\S]*?<\/table>/gi) ?? []

  for (const table of tables) {
    const headers = cellsOf(table, 'th')
    // 版面用的表格沒有表頭，或第一欄不是公司代號 —— 都不是我們要的資料表
    if (headers[0] !== '公司代號') continue

    const iRevenue = columnOf(headers, H_REVENUE)
    if (iRevenue === null) continue // 銀行業：沒有單一營收欄，整張表跳過
    const iGross = columnOf(headers, H_GROSS)
    const iOperating = columnOf(headers, H_OPERATING)
    const iPretax = columnOf(headers, H_PRETAX)
    const iNet = columnOf(headers, H_NET)
    const iEps = columnOf(headers, H_EPS)

    for (const row of table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = cellsOf(row, 'td')
      if (cells.length < headers.length) continue
      const ticker = cells[0]
      if (!/^\d{4,6}$/.test(ticker)) continue
      if (wanted.size > 0 && !wanted.has(ticker)) continue

      const revenue = normNum(cells[iRevenue])
      // 分母為 0 或缺值時整列跳過：算出來的比率會是 Infinity 或 NaN，兩者都不能顯示
      if (revenue === null || revenue === 0) continue

      const ratio = (i: number | null): number | null => {
        if (i === null) return null
        const v = normNum(cells[i])
        return v === null ? null : round2((v / revenue) * 100)
      }

      out.set(ticker, {
        yearQuarter,
        // 這份表的金額單位是千元，與 t187ap17_L 的百萬元不同 —— 換算後再存，
        // 否則同一個欄位會混著兩種單位，而畫面上看不出來是哪一種
        revenueMillionTwd: round2(revenue / 1000),
        grossMarginPercent: ratio(iGross),
        operatingMarginPercent: ratio(iOperating),
        pretaxMarginPercent: ratio(iPretax),
        netMarginPercent: ratio(iNet),
        epsTwd: iEps === null ? null : normNum(cells[iEps]),
        // 這一列我們確實看過了：即使沒有 EPS 欄，也不必再抓一次同一季
        epsChecked: true,
      })
    }
  }
  return out
}

/** 比率取兩位小數，與 `t187ap17_L` 的精度一致（對過答案，逐位吻合） */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface ProfitProgress {
  /** 這檔已有的季別 */
  quarters: Set<string>
  /**
   * 已有、但**還沒去季報找過 EPS** 的季別（0.6.28）。未給代表沒有這種缺口。
   *
   * 每晚的 `t187ap17_L` 只給四項比率，所以新的一季會先以「有比率、沒 EPS」落地；
   * EPS 只有 MOPS 季報有，得靠回補補上。
   */
  needEps?: Set<string>
  /** 最舊的**已嘗試**季別；null 代表從未回補過 */
  through: string | null
}

/**
 * 這一輪要去抓哪幾季。
 *
 * 判斷邏輯與 `planRevenueBackfill` 完全相同，理由也相同 ——
 * **缺口不是「檔案裡沒有的季別」，是「還沒去找過的季別」。**
 * ETF 永遠不在這份表裡，用前者判斷會讓它把最新幾季永遠釘在待抓清單上，
 * 整批回補就此卡死（0.6.4-dev.1 在月營收上實際踩過這個死結）。
 *
 * @returns 由新到舊；空陣列代表沒有要找的了，呼叫端應直接短路、不發任何請求
 */
export function planProfitBackfill(
  have: Map<string, ProfitProgress>,
  wantQuarters: string[],
  maxQuarters: number,
): string[] {
  if (have.size === 0 || maxQuarters <= 0) return []
  const missing = new Set<string>()
  for (const { quarters, needEps, through } of have.values()) {
    for (const yq of wantQuarters) {
      /*
        EPS 缺口不受 `through` 限制（0.6.28）。
        through 記的是「比它更舊的都還沒問過」，而 EPS 缺口恰好出現在**最新**那幾季
        （夜間批次剛寫進來、還沒被回補碰過），正好在 through 的另一側 ——
        沿用同一條判斷的話，新一季的 EPS 永遠補不到。
        `epsChecked` 保證這不會變成無限重抓：問過一次就不再算缺口，即使那一季真的沒有 EPS。
      */
      if (needEps?.has(yq)) {
        missing.add(yq)
        continue
      }
      if (quarters.has(yq)) continue
      if (through && yq >= through) continue
      missing.add(yq)
    }
  }
  // 由新到舊補：預算用完時留下的缺口是最舊的那幾季，對使用者的價值最低
  return [...missing].sort().reverse().slice(0, maxQuarters)
}

/** 這一輪跑完之後的 `through`：舊值與本輪實際嘗試過的季別取最舊 */
export function nextProfitThrough(
  prev: string | null | undefined,
  attempted: string[],
): string | null {
  const all = [...attempted, ...(prev ? [prev] : [])].filter(Boolean).sort()
  return all[0] ?? prev ?? null
}

/**
 * 由「現在」往回數 count 個**已公布**的季別，新到舊。
 *
 * 台灣的申報期限：Q1 → 5/15、Q2 → 8/14、Q3 → 11/14、Q4（年報）→ 次年 3/31。
 * 這裡一律往後抓五天當緩衝 —— 抓一個還沒公布的季別不會壞（回一張幾乎空的表），
 * 但每輪都白跑一次 1.6 MB 的請求。
 */
export function publishedQuarters(now: Date, count: number): string[] {
  // 台北時間（UTC+8 固定偏移，台灣無日光節約）
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const y = taipei.getUTCFullYear()
  const md = (taipei.getUTCMonth() + 1) * 100 + taipei.getUTCDate()

  // 今年最新一個「應該已公布」的季別；都還沒到就退回去年 Q4
  let latest: { y: number; q: number }
  if (md >= 1119) latest = { y, q: 3 }
  else if (md >= 819) latest = { y, q: 2 }
  else if (md >= 520) latest = { y, q: 1 }
  else if (md >= 405) latest = { y: y - 1, q: 4 }
  else latest = { y: y - 1, q: 3 }

  const out: string[] = []
  let { y: cy, q: cq } = latest
  for (let i = 0; i < Math.max(0, count); i++) {
    out.push(`${cy}-Q${cq}`)
    cq -= 1
    if (cq === 0) {
      cq = 4
      cy -= 1
    }
  }
  return out
}
