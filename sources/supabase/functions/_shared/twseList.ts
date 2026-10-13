/**
 * TWSE (上市) daily close list: endpoints and the CSV parser (BUG-120).
 *
 * The OpenAPI `STOCK_DAY_AVG_ALL` carries ~29,700 rows, ~28,360 of them warrants, and measured
 * 2026-10-13 10:30 Asia/Taipei it took 10.2 s gzipped (528 KB) and did not finish in 40 s
 * uncompressed (3 MB+). Every caller had a 10 s timeout, so `twlist` failed with
 * `TWSE Signal timed out.` most trading days. `STOCK_DAY_ALL?response=open_data` is the same
 * day's close for the 1,381 stocks/ETFs only: 137 KB in 0.1 s at the same moment.
 *
 * Coverage given up: TWSE warrants (the TPEx list never had OTC warrants). The OpenAPI stays as
 * the fallback, with its warrants filtered out, so both sources return the same set.
 *
 * Pure and free of Deno imports: the web app (src/services/twMarketData.ts) and both Edge
 * Functions use it, and vitest runs its tests.
 */

export const TWSE_STOCK_DAY_ALL_URL = 'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data'
export const TWSE_OPENAPI_LIST_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL'

/** Same row shape as the OpenAPI, so `buildTwList` and `parseTwNames` read either source. */
export interface TwseListRow {
  Code: string
  Name: string
  ClosingPrice: string
}

/** One CSV line, honouring double quotes and `""` escapes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell)
  return cells
}

/**
 * Parses `STOCK_DAY_ALL?response=open_data`. Header checked 2026-10-13:
 * `日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數`.
 * Columns are found by header name; a body without them (an HTML error page, a changed format)
 * yields `[]`, which every caller treats as a failed source.
 */
export function parseStockDayAllCsv(text: string): TwseListRow[] {
  // A leading BOM needs no strip: `trim()` below removes U+FEFF from the header cell.
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const header = splitCsvLine(lines[0]).map((h) => h.trim())
  const code = header.indexOf('證券代號')
  const name = header.indexOf('證券名稱')
  const close = header.indexOf('收盤價')
  if (code < 0 || name < 0 || close < 0) return []
  const rows: TwseListRow[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const c = (cells[code] ?? '').trim()
    const n = (cells[name] ?? '').trim()
    if (c && n) rows.push({ Code: c, Name: n, ClosingPrice: (cells[close] ?? '').trim() })
  }
  return rows
}

/**
 * TWSE warrant / CBBC codes: six characters starting 03–08 (`030001`, `04001T`, `080000`).
 * Checked 2026-10-13 against the OpenAPI list: every one of its 28,360 codes missing from
 * `STOCK_DAY_ALL` matches this, and no `STOCK_DAY_ALL` code does.
 */
export function isTwseWarrantCode(code: string): boolean {
  return /^0[3-8]\d{3}[0-9A-Z]$/.test(code.trim().toUpperCase())
}

/**
 * TWSE rows in the OpenAPI shape: STOCK_DAY_ALL, else the OpenAPI without its warrants.
 * `onFallback` gets the reason the CSV leg failed, so a broken primary is visible even while the
 * fallback keeps answering (it is the 10 s+ source BUG-120 moved away from). Rejects with both
 * reasons when both fail. Timeouts belong to the injected fetchers.
 */
export async function loadTwseRows(
  fetchText: (url: string) => Promise<string>,
  fetchJson: (url: string) => Promise<unknown>,
  onFallback: (reason: string) => void | Promise<void>,
): Promise<Array<Record<string, unknown>>> {
  let primaryReason: string
  try {
    const rows = parseStockDayAllCsv(await fetchText(TWSE_STOCK_DAY_ALL_URL))
    if (rows.length > 0) return rows as unknown as Array<Record<string, unknown>>
    primaryReason = 'STOCK_DAY_ALL 無可用資料'
  } catch (err) {
    primaryReason = `STOCK_DAY_ALL ${err instanceof Error ? err.message : String(err)}`
  }
  await onFallback(primaryReason)
  let raw: unknown
  try {
    raw = await fetchJson(TWSE_OPENAPI_LIST_URL)
  } catch (err) {
    throw new Error(`${primaryReason}; OpenAPI ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!Array.isArray(raw)) throw new Error(`${primaryReason}; OpenAPI response is not an array`)
  return (raw as Array<Record<string, unknown>>).filter((r) => !isTwseWarrantCode(String(r?.Code ?? '')))
}
