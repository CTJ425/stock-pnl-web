# Task 133 — MOPS probe sources never retire (six slots a day, always)

## Problem

`REQUIRED_LANDED_COUNTS` gives the two MOPS sources `1`, so they retire on their **first**
landed round. `sourceLanded()` for MOPS is `atLeast(filePeriod, upstreamPeriod)` with `>=`,
which is true as soon as the file already holds that period — so on a publication day
`mops_profit` lands at the 12:00 slot and the remaining five slots never run.

Measured on DEV (`source_probe_tick`, 2026-08-17 … 2026-08-24): `mops_profit` has **exactly one
tick per day, at 12:00**, every day. The six `MOPS_SLOTS` exist but only the first is used.

The MOPS aggregate tables are re-issued through the day as more companies file, so a source that
stops after the first landing cannot see the later, larger issue of the same day.

## Decision

The two MOPS sources **never retire**. They probe all six `MOPS_SLOTS` every weekday,
regardless of hits or landings. The six daily sources keep the existing trailing-run rule
(3 consecutive identical fingerprints; any content change resets the run).

Accepted cost: on a publication day a MOPS hit fires `generate-history` on each of the six
slots instead of once. This is inside the existing envelope — `borrow` already fires
`generate-chips` 13 times on a DEV day, and `bfi82u` fires `sync-market` 6 times.

## Contract

### Edge — `sourceProbePlan.ts`

- `REQUIRED_LANDED_COUNTS.mops_revenue` and `.mops_profit` become `Number.POSITIVE_INFINITY`.
  `retiredSources()` compares `counts[id] >= required[id]`, so an infinite requirement can never
  be met — **no change to `retiredSources()` itself**. Keep one knob; do not add a second
  never-retire set.
- The six daily sources keep `3`. `trailingRun()`, `summariseLandedTicks()`, `sourceLanded()`,
  `MOPS_SLOTS`, `sourcesForTaipeiTime()` and `PROBE_FOLLOW_UP` are unchanged.
- Update the doc comment above `REQUIRED_LANDED_COUNTS` to state the new MOPS rule and why
  (the same-day re-issue argument above). Remove the stale sentence claiming MOPS keeps the
  old "retire on first landing" behaviour.

### UI — `ProbeWarRoom.tsx`

- `WarRoomSourceConfig` gains `neverRetires?: boolean`.
- Both MOPS entries: `target: 6`, `neverRetires: true`. Daily entries unchanged (`target: 3`).
- For a `neverRetires` source:
  - `isRetired` is **always `false`** — the card must never print 「退休」 or 「收工」.
  - the progress numerator is the number of **probed slots** for the day (`sourceTicks.length`),
    not `hitCount`; the denominator stays `target` (6).
  - the unit label is `/ 6 槽` (not `次命中` / `次到位`).
  - status text: `0` slots → `⏳ 待機中` (`statusType: 'waiting'`); `1`–`5` → `🟢 探測中 (n/6 槽)`
    (`statusType: 'probing'`); `6` → `✅ 六槽跑完` (`statusType: 'retired'`, so the card renders in
    the done style and counts into the summary tag).
  - `isProbing` must be **false** once all six slots are done, so the last hit chip gets neither a
    `退休` nor a `最新` suffix there.
  - the hit-time chips keep the existing 「命中：」 line and still list **hit** times.
  - the progress-dot `aria-label` becomes `槽次進度 n/6` for these sources.
- Daily sources keep every existing behaviour, including `n/ 3 次命中` → `n/ 3 次到位` and the
  `退休` suffix on the last chip.
- The summary tag 「已退休 N 源」 becomes 「收工 N 源」 (one word covers retirement and 六槽跑完).
- The note line under the heading becomes:
  `全天候每 5 分鐘巡邏，命中即觸發抓取，3 次穩定到位自動退休收工（MOPS 兩源不退休，平日六槽全跑）。`

### UI — `MechanismGuide.tsx`

- `PROBE_SOURCES_CONFIG`: both MOPS rows get `retirement: '不退休 (六槽全跑)'`, and their
  `description` states that a hit does not end the day — all six slots run.

## Files

- `sources/supabase/functions/stock-report/sourceProbePlan.ts`
- `sources/src/components/Admin/ProbeWarRoom.tsx`
- `sources/src/components/Admin/MechanismGuide.tsx`

Nothing else. Do not touch `index.ts`, `probeRound.ts`, `schema.sql`, any `*.test.*` file, or
`docs/`.

## Verify

From `sources/`:

```
npm test -- sourceProbePlan.test.ts ProbeWarRoom.test.tsx MechanismGuide.test.tsx
```

Not done until it passes **and the process exit code is 0** (the vitest summary line can read
"passed" on a red gate).

## Test charter

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| `retiredSources({ mops_revenue: 1, mops_profit: 1 })` | empty set | `sourceProbePlan.test.ts` |
| `retiredSources({ mops_revenue: 6, mops_profit: 99 })` | empty set | `sourceProbePlan.test.ts` |
| `REQUIRED_LANDED_COUNTS.mops_*` | `Number.POSITIVE_INFINITY` | `sourceProbePlan.test.ts` |
| `retiredSources({ bfi82u: 2, t86: 3, mops_revenue: 1 })` | `{'t86'}` only | `sourceProbePlan.test.ts` |
| daily sources at count 3 | still retire | `sourceProbePlan.test.ts` |
| all six `MOPS_SLOTS` | still plan both MOPS ids | `sourceProbePlan.test.ts` |
| MOPS card, 1 tick | `🟢 探測中 (1/6 槽)`, `1/ 6 槽`, no 「退休」/「收工」 | `ProbeWarRoom.test.tsx` |
| MOPS card, 6 ticks | `✅ 六槽跑完`, no 「退休」 | `ProbeWarRoom.test.tsx` |
| MOPS card, 0 ticks | `⏳ 待機中` | `ProbeWarRoom.test.tsx` |
| daily card at 3 hits | unchanged `✅ 已退休`, `3/ 3 次到位`, `15:15 退休` | `ProbeWarRoom.test.tsx` |
| guide table MOPS rows | `不退休 (六槽全跑)` | `MechanismGuide.test.tsx` |

## Non-goals

- No change to `sourceLanded()` / the `atLeast` period criterion.
- No change to `MOPS_SLOTS` (still six, still those times).
- No deduplication of the `generate-history` follow-up across slots.
- No deploy. PROD Edge deployment needs an explicit instruction from the user.
