// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QuoteTab, quoteMeta } from './QuoteTab'
import type { PriceQuote } from '../../services/priceProxy'

/** 2026-08-05 收盤後的 2330 實測回應 */
const closedQuote: PriceQuote = {
  price: 2405,
  prevClose: 2320,
  open: 2385,
  high: 2415,
  low: 2370,
  volume: 31851,
  tradeDate: '20260805',
  tradeTime: '13:30:00',
  trial: false,
  asOf: '2026-08-05T07:30:00.000Z',
  source: 'edge',
  stale: false,
}

const cells = () =>
  [...document.querySelectorAll('.rpt-card')].map((el) => ({
    k: within(el as HTMLElement).getByText(/.+/, { selector: '.k' }).textContent,
    v: (el.querySelector('.v') as HTMLElement).textContent,
  }))

describe('QuoteTab', () => {
  beforeEach(cleanup)

  it('收盤後：七格照「開盤 最高 成交量 / 昨收 最低 預估 / 今收」排列', () => {
    render(<QuoteTab quote={closedQuote} />)
    expect(cells()).toEqual([
      { k: '開盤', v: 'NT$2,385.00' },
      { k: '最高', v: 'NT$2,415.00' },
      { k: '成交量', v: '31,851 張' },
      { k: '昨收', v: 'NT$2,320.00' },
      { k: '最低', v: 'NT$2,370.00' },
      { k: '預估', v: '—' },
      { k: '今收', v: 'NT$2,405.00' },
    ])
  })

  it('收盤後今收比昨收高 → 紅色（台灣看盤習慣）', () => {
    const { container } = render(<QuoteTab quote={closedQuote} />)
    const last = [...container.querySelectorAll('.rpt-card')].pop()!
    expect(last.querySelector('.v')?.className).toContain('pnl-up')
  })

  it('盤中：那格叫「成交」而不是「今收」', () => {
    render(<QuoteTab quote={{ ...closedQuote, tradeTime: '11:05:23' }} />)
    const labels = cells().map((c) => c.k)
    expect(labels).toContain('成交')
    expect(labels).not.toContain('今收')
  })

  it('試撮中才顯示預估價', () => {
    render(<QuoteTab quote={{ ...closedQuote, tradeTime: '08:45:00', trial: true }} />)
    const estimate = cells().find((c) => c.k === '預估')
    expect(estimate?.v).toBe('NT$2,405.00')
  })

  it('備援路徑沒有開高低量時各格顯示「—」，不是 0', () => {
    render(
      <QuoteTab
        quote={{
          ...closedQuote,
          open: null,
          high: null,
          low: null,
          volume: null,
          prevClose: null,
        }}
      />,
    )
    const map = Object.fromEntries(cells().map((c) => [c.k, c.v]))
    expect(map['開盤']).toBe('—')
    expect(map['成交量']).toBe('—')
    expect(map['昨收']).toBe('—')
  })

  it('尚無成交量是 0 張，與「取不到」分開顯示', () => {
    render(<QuoteTab quote={{ ...closedQuote, volume: 0 }} />)
    expect(Object.fromEntries(cells().map((c) => [c.k, c.v]))['成交量']).toBe('0 張')
  })

  it('抓不到報價時顯示空狀態，不畫出七格空表', () => {
    render(<QuoteTab quote={null} />)
    expect(screen.getByText('目前抓不到這檔股票的報價。')).toBeTruthy()
    expect(document.querySelectorAll('.rpt-card')).toHaveLength(0)
  })
})

describe('quoteMeta', () => {
  it('標出交易日、狀態與撮合時間', () => {
    expect(quoteMeta(closedQuote)).toBe('8/5 · 已收盤 · 13:30:00')
    expect(quoteMeta({ ...closedQuote, tradeTime: '11:05:23' })).toBe('8/5 · 盤中 · 11:05:23')
    expect(quoteMeta({ ...closedQuote, tradeTime: '08:45:00', trial: true })).toBe(
      '8/5 · 試撮中 · 08:45:00',
    )
  })

  it('快取價明講是快取；沒有報價就說沒有', () => {
    expect(quoteMeta({ ...closedQuote, stale: true })).toBe('8/5 · 已收盤 · 13:30:00 · 快取')
    expect(quoteMeta(null)).toBe('尚未取得')
  })

  it('美股 / 備援路徑沒有交易日時不硬湊', () => {
    expect(quoteMeta({ ...closedQuote, tradeDate: null, tradeTime: null })).toBe('盤中')
  })
})
