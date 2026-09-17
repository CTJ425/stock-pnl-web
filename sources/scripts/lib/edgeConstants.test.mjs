// Task 165 Phase 2 step 2b: the Edge holdings card re-states three fee constants from the web
// (spec docs/agent/specs/discord-holdings.md §2.3 — D6 keeps the web files untouched).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { DEFAULT_FEE_RATE } from '../../src/utils/fees.ts'
import { DEFAULT_MIN_FEE_ODD, DEFAULT_MIN_FEE_WHOLE } from '../../src/utils/settings.ts'
import * as card from '../../supabase/functions/stock-report/holdingsCard.ts'

describe('holdingsCard fee constants match the web', () => {
  it('DEFAULT_FEE_RATE', () => {
    expect(card.DEFAULT_FEE_RATE).toBe(DEFAULT_FEE_RATE)
  })

  it('minimum fees for whole and odd lots', () => {
    expect(card.DEFAULT_MIN_FEE_WHOLE).toBe(DEFAULT_MIN_FEE_WHOLE)
    expect(card.DEFAULT_MIN_FEE_ODD).toBe(DEFAULT_MIN_FEE_ODD)
  })
})

// Reviewer RISK (step 2b): holdingsCard.ts re-states discordSummary.ts's module-private width
// table and colours (D6 freezes that file), so the two copies are compared as source text.
describe('holdingsCard display-width table and colours match discordSummary', () => {
  const read = (name) =>
    readFileSync(fileURLToPath(new URL(`../../supabase/functions/stock-report/${name}`, import.meta.url)), 'utf8')
  const block = (src, re) => {
    const m = src.match(re)
    expect(m, String(re)).not.toBeNull()
    return m[0].replace(/\s+/g, '')
  }
  const summarySrc = read('discordSummary.ts')
  const cardSrc = read('holdingsCard.ts')

  it('WIDE_RANGES', () => {
    const re = /const WIDE_RANGES[^=]*=\s*\[[\s\S]*?\n\]/
    expect(block(cardSrc, re)).toBe(block(summarySrc, re))
  })

  it('zero-width code points in dispWidth', () => {
    const re = /if \(cp === 0xfe0f \|\| cp === 0x200d\) continue/
    expect(block(cardSrc, re)).toBe(block(summarySrc, re))
  })

  it.each(['RED', 'GREEN', 'GREY'])('%s', (name) => {
    const re = new RegExp(`const ${name} = 0x[0-9a-f]+`)
    expect(block(cardSrc, re)).toBe(block(summarySrc, re))
  })
})
