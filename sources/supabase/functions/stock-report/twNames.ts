/**
 * The exchanges' official short names for TW codes (BUG-109), for the Discord holdings card.
 *
 * The card used to label a holding with the newest transaction's name, so a broker export's
 * spelling (玉山's 「台灣５０」) or an older name (「主動統一」 for 00981A, officially
 * 「主動統一台股增長」) reached Discord. The web app labels from the same two lists
 * (src/services/twMarketData.ts → `twOfficialName`); this is the Edge side of that rule.
 *
 * Fetched once per run, not per user. A source that fails only costs its names: every code it
 * would have named falls back to the transaction's name, which is what the card printed before.
 */
export type TwNames = ReadonlyMap<string, string>

export const TWSE_LIST_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL'
export const TPEX_LIST_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'

/** Code → name from the TWSE (`Code`/`Name`) and TPEx (`SecuritiesCompanyCode`/`CompanyName`) shapes. */
export function parseTwNames(...lists: unknown[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const r of list as Array<Record<string, unknown>>) {
      const code = String(r?.Code ?? r?.SecuritiesCompanyCode ?? '').trim().toUpperCase()
      const name = String(r?.Name ?? r?.CompanyName ?? '').trim()
      if (code && name && !names.has(code)) names.set(code, name)
    }
  }
  return names
}

/** One load per returned function: every user of a run shares it. Never rejects. */
export function memoTwNames(fetchJson: <T>(url: string) => Promise<T>): () => Promise<TwNames> {
  let pending: Promise<TwNames> | null = null
  return () => {
    pending ??= Promise.allSettled([fetchJson<unknown>(TWSE_LIST_URL), fetchJson<unknown>(TPEX_LIST_URL)]).then(
      (results) => parseTwNames(...results.map((r) => (r.status === 'fulfilled' ? r.value : null))),
    )
    return pending
  }
}
