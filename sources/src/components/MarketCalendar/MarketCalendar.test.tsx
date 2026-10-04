// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { closedNote } from './marketCalendar'
import { TwCalendarLine } from './TwCalendarLine'

const taipei = (ymd: string) => new Date(`${ymd}T10:00:00+08:00`)

describe('closedNote', () => {
  it('休市當天、前一天、週五遇到下週一休市', () => {
    expect(closedNote('20261009')).toBe('今天休市（國慶日）')
    expect(closedNote('20261008')).toBe('明天休市（國慶日）')
    // 10-26 (Mon) is a holiday; the Friday before names the day instead of saying 明天
    expect(closedNote('20261023')).toBe('10月26日（一）休市（臺灣光復暨金門古寧頭大捷紀念日）')
  })

  it('平常日與週末不寫', () => {
    expect(closedNote('20261005')).toBeNull()
    expect(closedNote('20261010')).toBeNull()
  })
})

describe('TwCalendarLine', () => {
  afterEach(cleanup)

  it('開市日寫下一個休市日，日曆預設收起', () => {
    render(<TwCalendarLine now={taipei('2026-10-05')} />)
    expect(screen.getByText(/今天開市・下一個休市日 10月9日（五） 國慶日・4 天後/)).toBeTruthy()
    expect(document.querySelector('details')?.open).toBe(false)
  })

  it('休市日寫原因與下一個交易日；從總覽連過來時日曆展開', () => {
    render(<TwCalendarLine now={taipei('2026-10-09')} defaultOpen />)
    expect(screen.getByText(/今天休市（國慶日）・現價停在前一個交易日收盤・下一個交易日 10月12日（一）/)).toBeTruthy()
    expect(document.querySelector('details')?.open).toBe(true)
    // Only holidays still ahead are listed for users
    const rows = [...document.querySelectorAll('.mcal-list tbody tr')].map((r) => r.textContent)
    expect(rows).toEqual([
      '10月9日（五）國慶日今天',
      '10月26日（一）臺灣光復暨金門古寧頭大捷紀念日17 天後',
      '12月25日（五）行憲紀念日77 天後',
    ])
  })

  it('清單沒涵蓋的年份直說還沒更新', () => {
    render(<TwCalendarLine now={taipei('2027-01-04')} />)
    expect(screen.getByText(/今天開市・2027 年休市日還沒更新/)).toBeTruthy()
    expect(document.querySelector('.mcal-grid')).toBeNull()
  })
})
