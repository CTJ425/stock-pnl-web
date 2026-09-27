// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { BarSeriesChart } from './BarSeriesChart'

afterEach(cleanup)

const series = [
  { name: '外資', color: 'var(--chart-c1)', values: [300, -200] },
  { name: '投信', color: 'var(--chart-c2)', values: [100, 50] },
]

describe('BarSeriesChart stacked', () => {
  it('stacks every series into one bar per label and reports the day total', () => {
    const { container, getByRole } = render(
      <BarSeriesChart labels={['9/24', '9/25']} series={series} stacked formatValue={(v) => `${v} 張`} ariaLabel="三大法人" />,
    )
    const marks = [...container.querySelectorAll('rect')].filter((r) => r.getAttribute('fill')?.startsWith('var('))
    expect(marks).toHaveLength(4)
    // Day one: both positive → one column, 外資 below 投信 (same x).
    expect(marks[0].getAttribute('x')).toBe(marks[1].getAttribute('x'))
    const hit = [...container.querySelectorAll('rect[fill="transparent"]')][0]
    fireEvent.mouseEnter(hit)
    expect(getByRole('status').textContent).toContain('合計 400 張')
  })

  it('reports picks through onSelect', () => {
    const picked: number[] = []
    const { container } = render(
      <BarSeriesChart labels={['2024年', '2025年']} series={[{ name: '已實現', values: [10, -5] }]} formatValue={String} ariaLabel="每年" onSelect={(i) => picked.push(i)} selectedIndex={1} />,
    )
    fireEvent.click([...container.querySelectorAll('rect[fill="transparent"]')][0])
    expect(picked).toEqual([0])
  })
})
