/**
 * A workspace's fee rate is a fact with a validity period, not a scalar (Task 182).
 *
 * A broker can renegotiate the discount from a given date — 玉山 moved from 6.5 折 to 3.8 折 on
 * 2026-10-01 — and a trade made before that date was charged the old rate for good. The history
 * answers "which rate applied on date D"; the workspace's own `fee_rate` column keeps its original
 * meaning as the rate that applied **before the first segment**, so a client or an Edge Function
 * that has not seen this column still reads a real rate instead of nothing.
 *
 * Two different questions use this module, and mixing them up is the bug it exists to prevent:
 * - a recorded trade asks `rateOn(history, base, tx.tx_date)` — what the broker charged that day;
 * - an unrealized / break-even estimate asks `rateOn(history, base, today)` — what a sell made
 *   now would cost, which does not depend on when the lot was bought.
 */

import type { FeeRateSegment } from '../types/models'

export type { FeeRateSegment }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A rate is valid when it is a finite number, >= 0 and < 1 — same rule as `isValidFeeRate`. */
function validRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1
}

/**
 * The shape alone is not enough: '2026-13-99' matches the pattern but is not a date, and it would
 * sort after every real one — a segment that never takes effect, or takes effect over everything.
 * Round-tripping through Date rejects those and the impossible days (2026-02-30) too.
 */
function isCalendarDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false
  const parsed = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v
}

export function isFeeRateSegment(v: unknown): v is FeeRateSegment {
  if (typeof v !== 'object' || v === null) return false
  const seg = v as { from?: unknown; rate?: unknown }
  return typeof seg.from === 'string' && isCalendarDate(seg.from) && validRate(seg.rate)
}

/**
 * Sorts by date, keeps the last entry for a repeated date (a later save wins), and drops a segment
 * that does not actually change the rate. Invalid entries are discarded rather than thrown on:
 * this data is read from a JSONB column and from `localStorage`, so a single bad row must not take
 * the whole workspace down. Returns a new array; the input is never mutated.
 */
export function normalizeFeeRateHistory(
  raw: unknown,
  base?: number,
): FeeRateSegment[] {
  if (!Array.isArray(raw)) return []
  const byDate = new Map<string, number>()
  for (const entry of raw) {
    if (!isFeeRateSegment(entry)) continue
    byDate.set(entry.from, entry.rate)
  }
  const sorted = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([from, rate]) => ({ from, rate }))

  const out: FeeRateSegment[] = []
  let effective = validRate(base) ? base : null
  for (const seg of sorted) {
    if (effective !== null && seg.rate === effective) continue
    out.push(seg)
    effective = seg.rate
  }
  return out
}

/**
 * The fee rate that applied on `date`: the newest segment that had already taken effect, or `base`
 * when none had. `base` is `workspaces.fee_rate` (the rate before any segment); an invalid or
 * missing one falls back to `fallback`, which callers set to the statutory rate.
 */
export function rateOn(
  history: FeeRateSegment[] | null | undefined,
  base: number | null | undefined,
  date: string,
  fallback: number,
): number {
  const baseRate = validRate(base) ? base : fallback
  if (!Array.isArray(history) || history.length === 0) return baseRate
  let rate = baseRate
  for (const seg of history) {
    // The list is ascending, so the last segment on or before `date` is the effective one.
    if (!isFeeRateSegment(seg) || seg.from > date) break
    rate = seg.rate
  }
  return rate
}

/**
 * Records `rate` as effective from `from`, returning the new history. Used by the fee-settings
 * form: saving a new discount adds a segment instead of overwriting what the old one charged.
 */
export function withFeeRateFrom(
  history: FeeRateSegment[] | null | undefined,
  base: number | null | undefined,
  from: string,
  rate: number,
): FeeRateSegment[] {
  const existing = Array.isArray(history) ? history.filter(isFeeRateSegment) : []
  return normalizeFeeRateHistory([...existing, { from, rate }], base ?? undefined)
}

/** Drops the segment starting on `from`. */
export function withoutFeeRateFrom(
  history: FeeRateSegment[] | null | undefined,
  base: number | null | undefined,
  from: string,
): FeeRateSegment[] {
  const existing = Array.isArray(history) ? history.filter(isFeeRateSegment) : []
  return normalizeFeeRateHistory(
    existing.filter((seg) => seg.from !== from),
    base ?? undefined,
  )
}
