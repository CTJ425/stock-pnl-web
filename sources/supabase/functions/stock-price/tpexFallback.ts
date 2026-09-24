/**
 * Fallback snapshot of TPEx (OTC) stocks.
 * Used when TPEx OpenAPI endpoint is unreachable (e.g. upstream CDN SSL certificate issues).
 * The rows live in `tpexFallback.json` (one row per line); refresh it with
 * `npm run refresh:tpex-fallback`, which also stamps `generatedAt`.
 */
import snapshot from './tpexFallback.json' with { type: 'json' }

/** Generation date of the snapshot (EP-05). */
export const TPEX_FALLBACK_GENERATED_AT: string = snapshot.generatedAt

export const TPEX_FALLBACK_ROWS: Array<Record<string, unknown>> = snapshot.rows
