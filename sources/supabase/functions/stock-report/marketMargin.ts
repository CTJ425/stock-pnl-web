/**
 * Market-wide 融資融券 totals (Task 165), read from TWSE `MI_MARGN?selectType=MS` at send time.
 * The per-stock parser in `twChips.ts` deliberately ignores this table; this is its only reader.
 */
import { normNum } from './twChips.ts'

export interface MarginSummaryTable {
  title?: string
  fields?: string[]
  data?: string[][]
}

export interface MarginSummaryResponse {
  stat?: string
  date?: string
  tables?: MarginSummaryTable[]
}

export interface BalancePair {
  prev: number | null
  today: number | null
  change: number | null
}

export interface MarketMarginTotals {
  /** 'YYYY-MM-DD' */
  date: string
  /** 融資(交易單位) — lots (張) */
  marginLots: BalancePair
  /** 融券(交易單位) — lots (張) */
  shortLots: BalancePair
  /** 融資金額(仟元) — thousands of TWD */
  marginAmountThousandTwd: BalancePair
}

/** `ymd` is 'YYYYMMDD'. */
export function marginSummaryUrl(ymd: string): string {
  return `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${ymd}&selectType=MS&response=json`
}

function pair(row: string[] | undefined): BalancePair {
  const prev = row ? normNum(row[4]) : null
  const today = row ? normNum(row[5]) : null
  const change = prev !== null && today !== null ? today - prev : null
  return { prev, today, change }
}

export function extractMarketMarginTotals(resp: MarginSummaryResponse): MarketMarginTotals | null {
  if (resp.stat !== 'OK' || !resp.date || !/^\d{8}$/.test(resp.date)) return null

  const table = (resp.tables ?? []).find((t) => {
    const fields = t.fields
    return !!fields && fields[0]?.trim() === '項目' && fields[4] === '前日餘額' && fields[5] === '今日餘額'
  })
  if (!table || !table.data) return null

  const findRow = (label: string) => table.data!.find((row) => row[0]?.trim() === label)
  const marginRow = findRow('融資(交易單位)')
  const shortRow = findRow('融券(交易單位)')
  const amountRow = findRow('融資金額(仟元)')
  if (!marginRow || !shortRow || !amountRow) return null

  return {
    date: `${resp.date.slice(0, 4)}-${resp.date.slice(4, 6)}-${resp.date.slice(6, 8)}`,
    marginLots: pair(marginRow),
    shortLots: pair(shortRow),
    marginAmountThousandTwd: pair(amountRow),
  }
}
