/**
 * Contract: every Supabase Edge invoke carries a `timeout`.
 *
 * `supabase-js` has **no default timeout** on `functions.invoke`. Without one, an Edge Function
 * that hangs leaves the caller awaiting forever — the UI spinner never resolves and there is
 * nothing on screen to tell the user anything went wrong.
 *
 * `FunctionInvokeOptions.timeout` is a first-class option (`@supabase/functions-js`): it aborts
 * the underlying fetch, and `FunctionsClient.invoke` catches the abort and returns
 * `{ data: null, error }` like any other failure. So a timeout needs no new error handling at the
 * call site — every existing `if (error)` branch already covers it.
 *
 * This is a structural test rather than a behavioural one on purpose. The invariant is "no invoke
 * anywhere is missing a timeout", which is a property of the whole directory; asserting it per
 * service would mean standing up nine different mock fixtures to re-prove the same one line.
 */
import { describe, it, expect } from 'vitest'

// Vite's raw glob rather than node:fs — this file is type-checked by `tsconfig.app.json`, which
// carries only `vite/client` types, so a `node:*` import breaks `npm run build` (and with it the
// Pages deploy) while vitest itself still passes.
const MODULES = import.meta.glob('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Comments out, so that prose mentioning `functions.invoke` (several of these files document the
 * auth model in a JSDoc header) is not mistaken for a call site — the brace matcher would then
 * latch onto whatever `{` came next, usually an unrelated import.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

/** The options object literal of every `functions.invoke(...)` call in `src`, brace-matched. */
function invokeOptionBlocks(source: string): string[] {
  const src = stripComments(source)
  const blocks: string[] = []
  for (let i = src.indexOf('functions.invoke'); i !== -1; i = src.indexOf('functions.invoke', i + 1)) {
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

const sources: Array<{ file: string; src: string }> = Object.entries(MODULES)
  .filter(([path]) => !path.endsWith('.test.ts'))
  .map(([path, src]) => ({ file: path.replace('./', ''), src }))
  .filter(({ src }) => invokeOptionBlocks(src).length > 0)

describe('Edge invoke timeout contract', () => {
  it('finds the invoke call sites at all (guards the scanner itself)', () => {
    expect(sources.length).toBeGreaterThanOrEqual(9)
    expect(sources.flatMap(({ src }) => invokeOptionBlocks(src)).length).toBeGreaterThanOrEqual(10)
  })

  for (const { file, src } of sources) {
    it(`${file}: every functions.invoke passes a timeout`, () => {
      const blocks = invokeOptionBlocks(src)
      expect(blocks.length).toBeGreaterThan(0)
      for (const block of blocks) {
        expect(block, `${file} has a functions.invoke with no timeout:\n${block}`).toMatch(
          /\btimeout:\s*\d/,
        )
      }
    })
  }
})
