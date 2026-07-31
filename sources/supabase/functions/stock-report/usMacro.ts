/**
 * 美國總體經濟指標抓取與解析（FRED）。
 *
 * 為什麼是這五項：使用者要的是「核心 CPI / 核心 PPI / 核心非農就業 / 核心 PCE /
 * 核心 CCI / 核心消費者信心指數」。實際處理如下 ——
 *
 * - **「核心」只有 CPI / PPI / PCE 有標準定義**（排除食品與能源），照做。
 * - **「核心非農就業」不是既有概念**。市場實際看的是總非農就業的**月增人數**，
 *   故採 `PAYEMS` 的月變化，不硬造一個不存在的「核心非農」。
 * - **CCI 與消費者信心是同一件事**，且免費且仍在更新的只有密西根大學那支。
 *   Conference Board 的 CCI 是付費資料；FRED 上的 OECD 版 `CSCICP03USM665S`
 *   實測已停更（最後一筆 2024-01）。故依使用者定案合併為一項。
 *
 * 資料源（實測確認 2026-07-28）：
 *   https://fred.stlouisfed.org/graph/fredgraph.csv?id={序列}&cosd={起始日}
 *
 * 四個實測要點：
 *  1. **不需要 API key**。FRED 的 REST API 要金鑰，但 fredgraph 的 CSV 匯出不用。
 *     這也是選它而不是官方 API 的原因：少一組要保管的密鑰。
 *  2. **抓原始值，不用 `transformation=pc1`**。端點確實支援直接回年增率，
 *     但同一份原始序列可以同時算出年增、月增與指數值，而且算法是純函式、測得到；
 *     交給對方轉換就得為每種口徑各抓一次，也失去驗算的能力。
 *  3. **會有空值列**（例：`1952-12,`）。早年月份不是每月都有觀測值，
 *     解析時必須保留「這一期沒有值」而不是跳過或補 0。
 *  4. **不能送 twChips 那個瀏覽器 UA**（見 `MACRO_UA`）。
 *
 * 由 Edge Function 伺服器端抓取，故不受瀏覽器 CORS 限制。
 * 解析為純函式、不觸網，比照 twChips.ts / twFundamental.ts 的分工。
 */

import { normNum } from './twChips.ts'
import { fingerprint } from './pollPlan.ts'

/**
 * macro/us.json 的結構版本。前端守門用 `>=`（見 src/services/macroProxy.ts）。
 */
export const MACRO_SCHEMA = 1

/** 指標的呈現口徑。決定 `deriveIndicator` 怎麼從原始序列算出要顯示的數字 */
export type MacroKind = 'yoy' | 'momThousands' | 'index'

export interface MacroSeriesSpec {
  /** FRED 序列代號 */
  id: string
  label: string
  kind: MacroKind
  /** 這個指標在講什麼，一句白話（會直接顯示在畫面上） */
  note: string
}

/** 五個指標。順序即畫面順序：三個物價、一個就業、一個信心 */
export const FRED_SERIES: readonly MacroSeriesSpec[] = [
  {
    id: 'CPILFESL',
    label: '核心 CPI',
    kind: 'yoy',
    note: '消費者物價，排除食品與能源後的年增率',
  },
  {
    id: 'PPIFES',
    label: '核心 PPI',
    kind: 'yoy',
    note: '生產者物價，排除食品與能源後的年增率',
  },
  {
    id: 'PCEPILFE',
    label: '核心 PCE',
    kind: 'yoy',
    note: '聯準會最看重的通膨指標，排除食品與能源',
  },
  {
    id: 'PAYEMS',
    label: '非農就業',
    kind: 'momThousands',
    note: '非農業部門就業人數較上月增減',
  },
  {
    id: 'UMCSENT',
    label: '消費者信心',
    kind: 'index',
    note: '密西根大學消費者信心指數，數字越高越樂觀',
  },
]

/** 各口徑對應的顯示單位。單位不離開資料（沿用 twChips 的準則） */
export const MACRO_UNITS: Record<MacroKind, string> = {
  yoy: '%',
  momThousands: '千人',
  index: '指數',
}

/** 一期的觀測值。`value` 為 null 代表那一期沒有資料（FRED 會回空字串） */
export interface MacroPoint {
  /** 'YYYY-MM' */
  period: string
  value: number | null
}

export interface MacroIndicator {
  id: string
  label: string
  kind: MacroKind
  unit: string
  note: string
  /** 最新一期（已換算成 kind 的口徑）；沒有可用資料時為 null */
  latest: MacroPoint | null
  /** 前一期，用來看方向。同樣是換算後的口徑 */
  previous: MacroPoint | null
  /** 由舊到新，最多 12 期，已換算成 kind 的口徑 */
  points: MacroPoint[]
}

/** Storage 內 macro/us.json 的結構。**全域單檔，不是 per-ticker** */
export interface MacroFile {
  schema: number
  /**
   * **資料最後一次真的變動**的時間 ISO（不是最後一次執行的時間）。
   * 內容沒變時不會動它，所以它停著不代表排程壞了 —— 那要看 `checkedAt`。
   */
  asOf: string
  /**
   * 最後一次真的去問過 FRED 的時間 ISO。與 `asOf` 分離是 0.6.11 的修正：
   * 兩者合一時，「今天問過了」與「今天有新資料」分不開，正是慢一天的成因。
   * 舊檔沒有這個欄位，故為選填。
   */
  checkedAt?: string
  /**
   * 今天（台北日）已經真的去問過 FRED 幾次。0.6.15 起用來做自適應掃描：
   * 發布日要密集掃，但要有上限；跨日自動歸零（`ymd` 不同就重算）。
   */
  scansToday?: { ymd: string; n: number }
  region: '美國'
  indicators: MacroIndicator[]
}

/** 呈現幾期走勢 */
export const MACRO_POINTS = 12

/**
 * 年增率要拿 13 個月前的值當基期，12 期走勢就需要 24 個月，
 * 再加一個月的緩衝（月度資料的發布落差）。
 */
export const MACRO_LOOKBACK_MONTHS = 26

/**
 * 打 FRED 專用的 User-Agent。
 *
 * ⚠️ **不可以沿用 twChips.ts 的 `UA`**（那是瀏覽器字串，給 TWSE 用的）。
 * FRED 的防護會對「宣稱是瀏覽器卻不是瀏覽器」的請求**直接重置 HTTP/2 連線**
 * （`INTERNAL_ERROR`，連 HTTP 狀態碼都拿不到），0.6.5-dev.1 第一次部署就是這樣
 * 整批抓不到、而錯誤被 catch 吃掉，只剩 `macroSynced: false` 一個線索。
 *
 * 實測（2026-07-28，各試兩次）：
 *   ❌ `Mozilla/5.0 (Windows NT 10.0…Chrome/120…)`  連線被重置
 *   ❌ `stock-pnl-web/0.6.5`、`Deno`、空的 UA        同上
 *   ✅ `Deno/1.45.5`、`curl/8.5.0`、`python-requests/2.31.0`
 *   ✅ `stock-pnl-web (+https://github.com/CTJ425/stock-pnl-web)`
 *
 * 選最後這個：誠實表明自己是誰、附上聯絡處，是對公開資料源該有的禮貌，
 * 也不必賭 Deno 預設 UA 的格式哪天會不會變。
 */
export const MACRO_UA = 'stock-pnl-web (+https://github.com/CTJ425/stock-pnl-web)'

export function fredCsvUrl(id: string, since: string): string {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${since}`
}

/** 由「現在」往回推 months 個月的 YYYY-MM-01，給 `cosd` 用 */
export function fredSinceDate(now: Date, months: number): string {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - months
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}-01`
}

/**
 * FRED CSV → 由舊到新的觀測序列。
 *
 * 格式：第一列是表頭（`observation_date,CPILFESL`），其後每列 `YYYY-MM-DD,值`。
 * **空值列要保留為 `{ value: null }`**（實測 UMCSENT 早年有 `1952-12,` 這種列）——
 * 跳過會讓「前一期」錯位，補 0 會讓年增率算出天文數字。
 */
export function parseFredCsv(csv: string): MacroPoint[] {
  const out: MacroPoint[] = []
  for (const line of String(csv ?? '').split(/\r?\n/)) {
    const m = /^(\d{4})-(\d{2})-\d{2}\s*,\s*(.*)$/.exec(line.trim())
    if (!m) continue // 表頭與空行
    out.push({ period: `${m[1]}-${m[2]}`, value: normNum(m[3]) })
  }
  return out
}

/**
 * 把原始序列換算成該指標要顯示的口徑，並取最後 MACRO_POINTS 期。
 *
 * - `yoy`：與 12 個月前相比的百分比。基期缺值或為 0 時該期為 null（不硬算）。
 * - `momThousands`：與上一期的差（FRED 的 PAYEMS 本來就是千人）。
 * - `index`：原值照抄。
 *
 * 缺值一律以 null 表示，不以 0 冒充 —— 「這個月是 0」與「這個月沒有資料」
 * 在通膨與就業數據上是天差地遠的兩件事。
 */
export function deriveIndicator(spec: MacroSeriesSpec, raw: MacroPoint[]): MacroIndicator {
  const derived: MacroPoint[] = []
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i].value
    let value: number | null = null
    if (cur !== null) {
      if (spec.kind === 'index') {
        value = cur
      } else if (spec.kind === 'momThousands') {
        const prev = raw[i - 1]?.value
        if (prev !== null && prev !== undefined) value = round2(cur - prev)
      } else {
        const base = raw[i - 12]?.value
        if (base !== null && base !== undefined && base !== 0) {
          value = round2((cur / base - 1) * 100)
        }
      }
    }
    derived.push({ period: raw[i].period, value })
  }

  // 尾端可能有整段沒有換算結果（序列開頭 12 個月算不出年增），砍掉再取最後 N 期
  const usable = derived.filter((p) => p.value !== null).slice(-MACRO_POINTS)
  return {
    id: spec.id,
    label: spec.label,
    kind: spec.kind,
    unit: MACRO_UNITS[spec.kind],
    note: spec.note,
    latest: usable[usable.length - 1] ?? null,
    previous: usable[usable.length - 2] ?? null,
    points: usable,
  }
}

/** 小數兩位，避免浮點尾巴（沿用 aiPayload 的作法） */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 一組指標的內容指紋。`syncMacro` 用它決定「這次抓到的跟檔案裡的是不是同一份」。
 *
 * **為什麼需要它**（0.6.11 修 BUG-008）：原本的冪等鍵是台北日曆日 ——
 * 今天抓過就跳過。但 macro-daily 排兩班（13:00 / 15:00 UTC）的用意是
 * 「第一班沒接到就讓第二班補」，而第一班「成功抓到一份還沒更新的資料」時，
 * 台北日冪等會讓第二班一個請求都不發，於是要等到隔天。
 * 2026-07-30 的核心 PCE 就是這樣慢一天：BEA 美東 8:30 發布、FRED 匯入更晚，
 * 13:00 那班抓到的序列還沒有 2026-06 那一筆。
 * 改用內容指紋後，「今天問過了」與「今天拿到新東西了」才分得開。
 *
 * **要涵蓋整段 points，不能只比最新一期**：FRED 會回頭修正歷史值
 * （2026-07-30 那次 vintage 就同時把 2026-04 與 2026-05 改掉了）。
 * 只比 latest 的話，「最新期沒變但前幾期被修正」會被判定為沒變動而永遠不更新。
 *
 * **要先排序**：沿用 `pollPlan.ts` 的教訓 —— 來源的順序不保證穩定，
 * 直接對整包算指紋會把「順序換了」誤判成「內容變了」，讓比對永遠失效。
 * 這裡的 `parts` 以 `id` 開頭，排序 `parts` 即等同依 `id` 排序。
 */
export function macroFingerprint(indicators: readonly MacroIndicator[]): string {
  const parts = indicators
    .map((i) => `${i.id}|${i.points.map((p) => `${p.period}=${p.value ?? ''}`).join(',')}`)
    .sort()
  return fingerprint(parts)
}
