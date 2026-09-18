/**
 * A one-off layout probe (spec discord-holdings.md "Revision 7"): the same two cards written in
 * Discord markdown instead of a monospace fence, so the user can see on their own phone whether
 * headings and subtext render. Content is fixed sample text, not a renderer.
 */
import { describe, expect, it } from 'vitest'
import { buildMarkdownSamplePayload } from './markdownSample.ts'

const GEN = '2026-09-18T06:30:00.000Z'

describe('buildMarkdownSamplePayload', () => {
  const p = buildMarkdownSamplePayload(GEN)

  it('sends two clearly labelled sample cards', () => {
    expect(p.username).toBe('版面測試')
    expect(p.embeds).toHaveLength(2)
    expect(p.embeds[0].title).toBe('【版面測試】經濟快報 Markdown 版')
    expect(p.embeds[1].title).toBe('【版面測試】持股日報 Markdown 版')
    for (const e of p.embeds) {
      expect(e.timestamp).toBe(GEN)
      expect(e.footer?.text).toBe('這是排版測試訊息，不是今天的正式推播')
    }
  })

  it('uses markdown, never a monospace fence', () => {
    for (const e of p.embeds) {
      const d = e.description ?? ''
      expect(d).not.toContain('```')
      expect(d).toContain('**')
      expect(d).toContain('-# ')
      expect(d).toContain('### ')
    }
  })

  it('carries the numbers of the real 09/18 cards so the two layouts can be compared', () => {
    const brief = p.embeds[0].description ?? ''
    expect(brief).toContain('45,848.90')
    expect(brief).toContain('日經225')
    expect(brief).toContain('核心CPI')
    const holdings = p.embeds[1].description ?? ''
    expect(holdings).toContain('+1,519,625')
    expect(holdings).toContain('2330 台積電')
    expect(holdings).toContain('保本 502.69')
    expect(holdings).toContain('價金 497,388')
  })

  it('never allows a mention', () => {
    expect(p.allowed_mentions).toEqual({ parse: [] })
  })

  it('stays inside Discord embed limits', () => {
    for (const e of p.embeds) {
      expect((e.description ?? '').length).toBeLessThanOrEqual(4096)
      expect(e.title.length).toBeLessThanOrEqual(256)
    }
  })
})
