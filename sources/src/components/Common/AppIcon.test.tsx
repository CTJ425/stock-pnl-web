// @vitest-environment jsdom
/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { TrendingUp } from 'lucide-react'

import { readFileSync } from 'node:fs'

import { AppIcon, ICON_SIZE_PX, ICON_STROKE_WIDTH, type IconSizeToken } from './AppIcon'

afterEach(cleanup)

const TOKENS: IconSizeToken[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl']

function renderIcon(el: React.ReactElement) {
  const { container } = render(el)
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('AppIcon rendered no svg')
  return svg
}

describe('AppIcon', () => {
  it('renders the icon it is given', () => {
    const svg = renderIcon(<AppIcon icon={TrendingUp} />)
    expect(svg.tagName.toLowerCase()).toBe('svg')
  })

  it('defaults to the md token', () => {
    const svg = renderIcon(<AppIcon icon={TrendingUp} />)
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
    expect(svg.getAttribute('stroke-width')).toBe('1.75')
  })

  it.each(TOKENS)('maps token %s to its pixel size and stroke width', (token) => {
    const svg = renderIcon(<AppIcon icon={TrendingUp} size={token} />)
    expect(svg.getAttribute('width')).toBe(String(ICON_SIZE_PX[token]))
    expect(svg.getAttribute('height')).toBe(String(ICON_SIZE_PX[token]))
    expect(svg.getAttribute('stroke-width')).toBe(String(ICON_STROKE_WIDTH[token]))
  })

  it('passes a numeric size through and keeps the md stroke width', () => {
    const svg = renderIcon(<AppIcon icon={TrendingUp} size={19} />)
    expect(svg.getAttribute('width')).toBe('19')
    expect(svg.getAttribute('height')).toBe('19')
    expect(svg.getAttribute('stroke-width')).toBe('1.75')
  })

  it('lets an explicit strokeWidth beat the token default', () => {
    const svg = renderIcon(<AppIcon icon={TrendingUp} size="xs" strokeWidth={1} />)
    expect(svg.getAttribute('width')).toBe('12')
    expect(svg.getAttribute('stroke-width')).toBe('1')
  })

  it('passes className and other props through', () => {
    const svg = renderIcon(
      <AppIcon icon={TrendingUp} className="sort-ind" aria-label="up" color="var(--up)" />,
    )
    expect(svg.getAttribute('class')).toContain('sort-ind')
    expect(svg.getAttribute('aria-label')).toBe('up')
    expect(svg.getAttribute('stroke')).toBe('var(--up)')
  })
})

describe('--icon-* CSS tokens', () => {
  // vitest runs with `sources/` as its root, so this path is stable.
  const css = readFileSync('src/index.css', 'utf8')

  it.each(TOKENS)('declares --icon-%s with the same pixel value as the TS map', (token) => {
    const match = css.match(new RegExp(`--icon-${token}\\s*:\\s*(\\d+)px`))
    expect(match, `--icon-${token} is not declared in src/index.css`).not.toBeNull()
    expect(Number(match![1])).toBe(ICON_SIZE_PX[token])
  })
})
