// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { HelpTip } from './HelpTip'

afterEach(cleanup)

describe('HelpTip', () => {
  it('draws the trigger as a vector icon, not a "?" character', () => {
    const { container } = render(<HelpTip label="現價" text="最新成交價" />)
    const btn = container.querySelector('button.help-tip')
    expect(btn).not.toBeNull()
    expect(btn!.querySelector('svg.lucide-circle-question-mark')).not.toBeNull()
    expect(btn!.textContent).not.toContain('?')
  })

  it('keeps its accessible name so existing queries still resolve', () => {
    render(<HelpTip label="現價" text="最新成交價" />)
    expect(screen.getByRole('button', { name: '現價欄位說明' })).toBeTruthy()
  })
})
