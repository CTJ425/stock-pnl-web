/**
 * Which issuer (投信) runs a Taiwan ETF, read from its short name (Task 200, expansion release 1).
 *
 * Shared by the Edge sync (which ETFs it can fetch) and the browser (what the 成分股 tab says), so the
 * two can never disagree. TWSE short names open with the issuer's brand — 「元大台灣50」, 「中信台日韓PCB」,
 * 「國泰永續高股息」 — which is the only issuer field both sides already hold for every ETF code.
 */

export type EtfIssuerId =
  | 'yuanta'
  | 'ctbc'
  | 'cathay'
  | 'capital'
  | 'uni'
  | 'taishin'
  | 'kgi'
  | 'fubon'
  | 'fuhwa'
  | 'sinopac'

export interface EtfIssuer {
  id: EtfIssuerId
  /** As printed on the screen. */
  label: string
  /** Whether the sync has a parser for this issuer's holdings. */
  supported: boolean
}

/** Listed in the order issuers are named on screen; matching sorts a copy longest prefix first. */
const BRAND_LIST: Array<[prefix: string, issuer: EtfIssuer]> = [
  ['元大', { id: 'yuanta', label: '元大投信', supported: true }],
  ['中國信託', { id: 'ctbc', label: '中國信託投信', supported: true }],
  ['中信', { id: 'ctbc', label: '中國信託投信', supported: true }],
  ['國泰', { id: 'cathay', label: '國泰投信', supported: false }],
  ['群益', { id: 'capital', label: '群益投信', supported: true }],
  ['統一', { id: 'uni', label: '統一投信', supported: false }],
  ['台新', { id: 'taishin', label: '台新投信', supported: false }],
  ['凱基', { id: 'kgi', label: '凱基投信', supported: false }],
  ['富邦', { id: 'fubon', label: '富邦投信', supported: false }],
  ['復華', { id: 'fuhwa', label: '復華投信', supported: false }],
  ['永豐', { id: 'sinopac', label: '永豐投信', supported: false }],
]
const BRANDS = [...BRAND_LIST].sort((a, b) => b[0].length - a[0].length)

/** An ETF code: TWSE ETFs are the `00…` codes (0050, 00878, 009828, 00403A). */
export function isEtfCode(code: string): boolean {
  return /^00[0-9A-Z]{2,5}$/.test(code)
}

/**
 * The issuer behind an ETF's short name, or null when the name names none we know. Active ETFs put
 * 「主動」 before the brand (「主動統一台股增長」, 「主動元大AI新經濟」), so it is skipped first.
 */
export function etfIssuerOf(name: string): EtfIssuer | null {
  const n = name.trim().replace(/^主動/, '')
  for (const [prefix, issuer] of BRANDS) if (n.startsWith(prefix)) return issuer
  return null
}

/** Labels of the issuers the sync can fetch, for copy that lists them (「元大投信、中國信託投信」). */
export function supportedIssuerLabels(): string[] {
  return [...new Set(BRAND_LIST.filter(([, i]) => i.supported).map(([, i]) => i.label))]
}
