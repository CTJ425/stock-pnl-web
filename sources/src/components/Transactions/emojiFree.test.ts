/**
 * Guard: the three files migrated in Phase 2 must render vectors, not emoji.
 * A source scan is used where a render test would need heavy service mocking.
 * Comment lines are ignored on purpose — the blueprint's other hits are comments.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// vitest runs with `sources/` as its root, so these paths are stable.
const MIGRATED = [
  'src/components/Transactions/RecalcFeesModal.tsx',
  'src/components/Admin/MechanismGuide.tsx',
  'src/components/Common/HelpTip.tsx',
]

const EMOJI = /[⚠💡]/

function renderedLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
}

describe('Phase 2 emoji migration', () => {
  it.each(['src/components/Transactions/RecalcFeesModal.tsx', 'src/components/Admin/MechanismGuide.tsx'])(
    '%s has no emoji on a rendered line',
    (path) => {
      const offenders = renderedLines(path).filter((line) => EMOJI.test(line))
      expect(offenders, `emoji still rendered in ${path}`).toEqual([])
    },
  )

  it.each(MIGRATED)('%s imports AppIcon', (path) => {
    expect(readFileSync(path, 'utf8')).toMatch(/import \{[^}]*\bAppIcon\b[^}]*\} from '.*AppIcon'/)
  })
})
