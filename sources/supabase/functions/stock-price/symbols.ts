/**
 * Request validation for the symbol lists `stock-price` accepts (Task 185 / B1).
 *
 * Kept free of Deno and Supabase imports so plain vitest can test it — see symbols.test.ts.
 *
 * Why it exists: the function used to trust `symbols` as sent. A non-object element threw into the
 * 500 path, and a Taiwan ticker went into the MIS URL unencoded (`ex_ch=tse_${ticker}.tw`), so a
 * ticker such as `2330.tw|tse_t00` or `x&json=0` could rewrite the query it sends upstream. Yahoo
 * paths use `encodeURIComponent`, but a malformed ticker there only wastes an upstream call.
 */

export type SymbolMarket = 'TPE' | 'US' | 'IDX'

export interface SymbolItem {
  market: SymbolMarket
  ticker: string
}

const MARKETS: ReadonlySet<string> = new Set(['TPE', 'US', 'IDX'])

/** Anything the app sends: `2330`, `00679B`, `BRK.B`, `BF-B`, `^TWII`. Case is not significant. */
const TICKER = /^[A-Za-z0-9.^=-]{1,16}$/

/** A Taiwan code (stock, ETF, bond ETF) is letters and digits only — and it reaches the MIS URL. */
const TPE_TICKER = /^[0-9A-Za-z]{1,8}$/

export function isValidSymbol(value: unknown): value is SymbolItem {
  if (typeof value !== 'object' || value === null) return false
  const { market, ticker } = value as { market?: unknown; ticker?: unknown }
  if (typeof market !== 'string' || !MARKETS.has(market)) return false
  if (typeof ticker !== 'string' || !TICKER.test(ticker)) return false
  return market !== 'TPE' || TPE_TICKER.test(ticker)
}

/** The valid elements of `input`, reduced to `{ market, ticker }`; anything else is dropped. */
export function sanitizeSymbols(input: unknown): SymbolItem[] {
  if (!Array.isArray(input)) return []
  return input.filter(isValidSymbol).map(({ market, ticker }) => ({ market, ticker }))
}
