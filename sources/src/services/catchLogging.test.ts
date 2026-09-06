/**
 * Spec 146 Phase 2 — contract: a discarded failure must still be recorded.
 *
 * These five service files hold 14 `catch` blocks that return `null`, `[]`, `{}` or nothing and
 * report the failure to no one. That is why a blank page left no trace anywhere. Each one must
 * call `logClient` before it returns.
 *
 * Structural rather than behavioural on purpose: the invariant is "no catch in these files is
 * silent", which is a property of the whole file. Proving it per function would mean standing up
 * five different mock fixtures to re-prove the same one line — the same reasoning as
 * `invokeTimeout.test.ts`.
 *
 * `appLog.ts` is deliberately absent from this list. Its own catch blocks must NOT log: that is
 * recursion into the failure mode they exist to survive.
 */
import { describe, it, expect } from 'vitest'

const MODULES = import.meta.glob('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Files whose every catch must record. Counts are the sites found on 2026-09-06. */
const REQUIRED: Record<string, number> = {
  'aiChatStore.ts': 4,
  'feeSettings.ts': 2,
  'priceProxy.ts': 4,
  'reportsBucket.ts': 1,
  'twMarketData.ts': 3,
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

/** Every `catch` block body in the file, brace-matched. */
function catchBlocks(source: string): string[] {
  const src = stripComments(source)
  const blocks: string[] = []
  for (let i = src.indexOf('catch'); i !== -1; i = src.indexOf('catch', i + 1)) {
    const open = src.indexOf('{', i)
    if (open === -1) continue
    let depth = 0
    let j = open
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}' && --depth === 0) break
    }
    blocks.push(src.slice(open, j + 1))
  }
  return blocks
}

describe('silent catch contract', () => {
  for (const [file, expected] of Object.entries(REQUIRED)) {
    const src = MODULES[`./${file}`]

    it(`${file}: the scanner still finds all ${expected} catch blocks`, () => {
      expect(src, `${file} not found by the glob`).toBeTruthy()
      expect(catchBlocks(src)).toHaveLength(expected)
    })

    it(`${file}: every catch records through logClient`, () => {
      for (const block of catchBlocks(src)) {
        expect(block, `${file} has a silent catch:\n${block}`).toMatch(/\blogClient\s*\(/)
      }
    })
  }

  it('appLog.ts stays exempt — its own catch must not recurse into itself', () => {
    for (const block of catchBlocks(MODULES['./appLog.ts'])) {
      expect(block).not.toMatch(/\blogClient\s*\(/)
    }
  })
})
