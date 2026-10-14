/**
 * Is an ETF day futures-led (leveraged / inverse: 00685L, 00631L, 00632R) rather than a stock fund
 * (Task 200, release 2 review BLOCKER)? Shared by the Edge validation and the browser so the file
 * that gets written and the screen that draws it can never disagree.
 *
 * "No stocks" alone is not evidence: a truncated response for a stock fund (00919 with only its
 * 0.42 % futures line) would be written as a futures fund and could replace a complete day. A day is
 * futures-led only when the futures carry the fund — their weights, as published, add up (in absolute
 * value, so an inverse fund at −98 % counts) to at least `FUTURES_LED_MIN_PCT` **and** to more than
 * the stocks do. 2026-10-13: 00685L 200.94 % (no stocks) → futures-led; 00919 0.42 % → not.
 */
export const FUTURES_LED_MIN_PCT = 90

export function isFuturesLed(stockWeights: number[], futureWeights: number[]): boolean {
  const futures = futureWeights.reduce((a, w) => a + Math.abs(w), 0)
  const stocks = stockWeights.reduce((a, w) => a + w, 0)
  return futures >= FUTURES_LED_MIN_PCT && futures > stocks
}
