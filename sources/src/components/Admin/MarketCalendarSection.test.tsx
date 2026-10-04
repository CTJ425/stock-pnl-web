// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MarketCalendarSection } from './MarketCalendarSection'
import { holidaysOf, monthWeeks, nextHoliday, nextTradingDay, taipeiToday } from './marketCalendar'

/** Taipei wall clock → Date (Taiwan is fixed +8) */
const taipei = (ymd: string, hms = '10:00:00') => new Date(`${ymd}T${hms}+08:00`)

describe('marketCalendar', () => {
  it('以台北日期為今天', () => {
    expect(taipeiToday(taipei('2026-10-09', '00:30:00'))).toBe('20261009')
    expect(taipeiToday(taipei('2026-10-08', '23:59:59'))).toBe('20261008')
  })

  it('下一個交易日跳過平日休市與週末', () => {
    expect(nextTradingDay('20261008')).toBe('20261012') // 10-09 國慶日補假, then the weekend
    expect(nextTradingDay('20261004')).toBe('20261005')
    expect(nextHoliday('20261004')?.ymd).toBe('20261009')
    expect(nextHoliday('20261225')).toBeNull()
  })

  it('月曆以週日開頭，休市日帶名稱', () => {
    const weeks = monthWeeks(2026, 10) // 2026-10-01 is a Thursday
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, null])
    const oct9 = weeks.flat().find((d) => d?.ymd === '20261009')
    expect(oct9).toMatchObject({ kind: 'holiday', name: '國慶日' })
    expect(weeks.flat().find((d) => d?.ymd === '20261010')?.kind).toBe('weekend')
    expect(holidaysOf(2026)).toHaveLength(18)
  })
})

describe('MarketCalendarSection', () => {
  afterEach(cleanup)

  it('休市日顯示休市原因、下一個交易日，並圈出今天', () => {
    render(<MarketCalendarSection now={taipei('2026-10-09')} />)
    expect(screen.getByText('休市・國慶日')).toBeTruthy()
    expect(screen.getByText(/今天不向證交所即時報價抓價/)).toBeTruthy()
    expect(screen.getByText('10月12日（一）')).toBeTruthy()
    const today = document.querySelector('[aria-current="date"]')
    expect(today?.getAttribute('aria-label')).toBe('10月9日（五） 休市：國慶日（今天）')
  })

  it('開市日說明盤中每分鐘更新', () => {
    render(<MarketCalendarSection now={taipei('2026-10-05')} />)
    expect(screen.getByText('開市')).toBeTruthy()
    expect(screen.getByText(/每分鐘向證交所即時報價更新/)).toBeTruthy()
  })

  it('翻到清單沒涵蓋的年份會警告，並可回到今年', () => {
    render(<MarketCalendarSection now={taipei('2026-10-05')} />)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一年' }))
    expect(screen.getByRole('status').textContent).toMatch(/2027 年的休市日還沒放進清單/)
    fireEvent.click(screen.getByRole('button', { name: '回到今年' }))
    expect(screen.getByRole('heading', { name: '2026 年' })).toBeTruthy()
  })
})
