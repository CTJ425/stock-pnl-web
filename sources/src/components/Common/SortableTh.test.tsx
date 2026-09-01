// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { SortableTh, type SortState } from './SortableTh'

afterEach(cleanup)

const sort: SortState<'date'> = { key: 'date', dir: 'desc' }

describe('SortableTh', () => {
  it('draws its sort indicator at the xs token', () => {
    const { container } = render(
      <table>
        <thead>
          <tr>
            <SortableTh label="日期" sortKey="date" sort={sort} onSort={() => {}} />
          </tr>
        </thead>
      </table>,
    )
    const svg = container.querySelector('svg.sort-ind')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('width')).toBe('12')
    expect(svg!.getAttribute('height')).toBe('12')
    expect(svg!.getAttribute('stroke-width')).toBe('2')
  })

  it('still reports the clicked key', () => {
    const onSort = vi.fn()
    render(
      <table>
        <thead>
          <tr>
            <SortableTh label="日期" sortKey="date" sort={sort} onSort={onSort} />
          </tr>
        </thead>
      </table>,
    )
    fireEvent.click(screen.getByRole('button', { name: '日期' }))
    expect(onSort).toHaveBeenCalledWith('date')
  })
})
