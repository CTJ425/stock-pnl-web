// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FundamentalTab } from './FundamentalTab'
import type { FundamentalData } from '../../services/fundamentalProxy'

const full: FundamentalData = {
  ticker: '2330',
  asOf: '2026-07-27T09:31:00.000Z',
  dataDate: '2026-07-25',
  industry: '半導體業',
  valuation: { peRatio: 31.59, dividendYieldPercent: 0.94, pbRatio: 10.34, dataDate: '2026-07-24' },
  revenueUnit: '千元',
  revenueMonths: [
    {
      yearMonth: '2026-05',
      revenueThousandTwd: 416975163,
      momPercent: 1.2,
      yoyPercent: 40.1,
      cumulativeYoyPercent: 30,
    },
    {
      yearMonth: '2026-06',
      revenueThousandTwd: 442679969,
      momPercent: 6.16,
      yoyPercent: 67.87,
      cumulativeYoyPercent: 35.61,
    },
  ],
  profitQuarters: [],
  notes: [],
}

/** 這幾支測試不驗收合行為（另有專屬測試），一律以全展開渲染 */
const noCollapse = { collapsed: new Set<string>(), onToggle: () => {} }

describe('FundamentalTab', () => {
  afterEach(() => cleanup())

  const withProfit: FundamentalData = {
    ...full,
    profitQuarters: [
      {
        yearQuarter: '2025-Q4',
        revenueMillionTwd: 868459,
        grossMarginPercent: 59.01,
        operatingMarginPercent: 49.03,
        pretaxMarginPercent: 51.2,
        netMarginPercent: 43.11,
      },
      {
        yearQuarter: '2026-Q1',
        revenueMillionTwd: 1134103.44,
        grossMarginPercent: 66.25,
        operatingMarginPercent: 58.1,
        pretaxMarginPercent: 60.65,
        netMarginPercent: 50.51,
      },
    ],
  }

  it('獲利能力四格 KPI 取最新一季', () => {
    render(<FundamentalTab fundamental={withProfit} loading={false} {...noCollapse} />)
    // 「毛利率」同時是 KPI 標籤與表頭，故限定在 KPI 區塊內比對
    const labels = [...document.querySelectorAll('.kpi-label')].map((e) => e.textContent)
    expect(labels).toEqual(
      expect.arrayContaining(['毛利率', '營益率', '稅前純益率', '稅後純益率']),
    )
    // 值同樣同時出現在 KPI 與表格，故也限定在 KPI 區塊
    const values = [...document.querySelectorAll('.kpi-value')].map((e) => e.textContent)
    expect(values).toEqual(
      expect.arrayContaining(['+66.25%', '+58.10%', '+60.65%', '+50.51%']),
    )
    expect(screen.getByText(/2026 年第 1 季（已累積 2 季）/)).toBeTruthy()
  })

  it('季度趨勢表由新到舊，且只有一季時不出現表格', () => {
    const { unmount } = render(<FundamentalTab fundamental={withProfit} loading={false} {...noCollapse} />)
    const rows = document.querySelectorAll('.data-table')
    // 兩張表：獲利能力季度表 + 月營收表
    expect(rows).toHaveLength(2)
    const firstBodyRow = rows[0].querySelectorAll('tbody tr')[0]
    expect(firstBodyRow.textContent).toContain('2026 年第 1 季')
    unmount()

    const oneQuarter = { ...withProfit, profitQuarters: [withProfit.profitQuarters[1]] }
    render(<FundamentalTab fundamental={oneQuarter} loading={false} {...noCollapse} />)
    // 只剩月營收那張表；KPI 仍在
    expect(document.querySelectorAll('.data-table')).toHaveLength(1)
    expect(screen.getByText('+66.25%')).toBeTruthy()
  })

  it('沒有獲利能力資料時顯示空狀態，不影響其他區塊', () => {
    render(<FundamentalTab fundamental={full} loading={false} {...noCollapse} />)
    expect(screen.getByText('查無獲利能力資料。')).toBeTruthy()
    expect(screen.getByText('31.59')).toBeTruthy()
  })

  it('顯示估值三指標與資料日期', () => {
    render(<FundamentalTab fundamental={full} loading={false} {...noCollapse} />)
    expect(screen.getByText('31.59')).toBeTruthy()
    expect(screen.getByText('0.94%')).toBeTruthy()
    expect(screen.getByText('10.34')).toBeTruthy()
    expect(screen.getByText(/資料日 2026-07-24/)).toBeTruthy()
  })

  it('標示這份資料是我們何時產出的，以及一共幾個月', () => {
    // 沒有這行的話，畫面上少了幾個月時分不出是「資料就這樣」還是「你看到的是舊的一份」
    render(<FundamentalTab fundamental={full} loading={false} {...noCollapse} />)
    expect(screen.getByText(/資料更新於 2026-07-27 \d{2}:\d{2}（共 2 個月）/)).toBeTruthy()
  })

  it('產出時間與估值的「資料日」是兩個不同的東西，不可混為一談', () => {
    render(<FundamentalTab fundamental={full} loading={false} {...noCollapse} />)
    // 資料日 = 資料自己宣告的日期；資料更新於 = 我們抓到並寫檔的時刻
    expect(screen.getByText(/資料日 2026-07-24/)).toBeTruthy()
    expect(screen.getByText(/資料更新於 2026-07-27/)).toBeTruthy()
  })

  it('月營收表由新到舊列出並標示千元單位', () => {
    render(<FundamentalTab fundamental={full} loading={false} {...noCollapse} />)
    expect(screen.getByText('單位：千元')).toBeTruthy()
    const rows = screen.getAllByRole('row')
    // rows[0] 是表頭；第一列資料應是最新月份
    expect(rows[1].textContent).toContain('2026 年 06 月')
    expect(rows[1].textContent).toContain('442,679,969')
    expect(rows[1].textContent).toContain('+67.87%')
    expect(rows[2].textContent).toContain('2026 年 05 月')
  })

  it('缺值以「—」呈現而非 0', () => {
    render(
      <FundamentalTab
        fundamental={{
          ...full,
          valuation: {
            peRatio: null,
            dividendYieldPercent: null,
            pbRatio: 0.85,
            dataDate: '2026-07-24',
          },
          revenueMonths: [],
          profitQuarters: [],
        }}
        loading={false}
      {...noCollapse} />,
    )
    // 本益比與殖利率各一個「—」
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('查無月營收資料。')).toBeTruthy()
  })

  it('查無資料時顯示「尚未產生」空狀態', () => {
    render(<FundamentalTab fundamental={null} loading={false} {...noCollapse} />)
    expect(screen.getByText('基本面資料尚未產生')).toBeTruthy()
  })

  it('載入中顯示讀取提示', () => {
    render(<FundamentalTab fundamental={null} loading={true} {...noCollapse} />)
    expect(screen.getByText('正在讀取基本面…')).toBeTruthy()
  })

  it('上櫃缺料檔顯示 notes 說明', () => {
    render(
      <FundamentalTab
        fundamental={{
          ...full,
          industry: null,
          valuation: null,
          revenueMonths: [],
          profitQuarters: [],
          notes: ['此代號查無上市基本面資料（可能為上櫃股票，暫不支援）'],
        }}
        loading={false}
      {...noCollapse} />,
    )
    expect(screen.getByText(/可能為上櫃股票/)).toBeTruthy()
    expect(screen.getByText('查無估值資料。')).toBeTruthy()
  })

  it('月營收有走勢圖，且方向與表格相反（圖由舊到新、表由新到舊）', () => {
    const { container } = render(<FundamentalTab fundamental={full} loading={false} {...noCollapse} />)
    const poly = container.querySelector('.chart-wrap polyline')
    expect(poly).toBeTruthy()

    /*
      圖必須由舊到新。resource: revenueMonths 是 05 月 → 06 月（舊→新），
      而表格刻意 reverse 成新→舊 —— 圖若拿錯那份，整條線會反過來而且看起來像真的
      （趨勢完全相反），是最不容易被發現的錯，故用 y 座標直接釘住方向。
    */
    const [p1, p2] = (poly!.getAttribute('points') ?? '').split(' ')
    const y = (pt: string) => Number(pt.split(',')[1])
    // 05 月營收較低 → y 較大（SVG 的 y 往下增加）
    expect(y(p1)).toBeGreaterThan(y(p2))
  })

  it('走勢圖的 X 軸標籤帶年份（跨年時才分得出是哪一年）', () => {
    const { container } = render(<FundamentalTab fundamental={full} loading={false} {...noCollapse} />)
    const labels = [...container.querySelectorAll('.chart-wrap svg text')]
      .map((t) => t.textContent ?? '')
      .filter((t) => t.includes('/'))
    expect(labels).toEqual(['2026/05', '2026/06'])
  })

  it('營收缺值的月份把線斷開，不內插假資料', () => {
    const gap: FundamentalData = {
      ...full,
      revenueMonths: [
        { ...full.revenueMonths[0], yearMonth: '2026-03' },
        { ...full.revenueMonths[0], yearMonth: '2026-04', revenueThousandTwd: null },
        { ...full.revenueMonths[0], yearMonth: '2026-05' },
        { ...full.revenueMonths[1], yearMonth: '2026-06' },
      ],
    }
    const { container } = render(<FundamentalTab fundamental={gap} loading={false} {...noCollapse} />)
    // 前段只剩一個點（畫不出線）被丟棄，只留 05→06 那一段
    expect(container.querySelectorAll('.chart-wrap polyline')).toHaveLength(1)
  })

  it('查無月營收時不畫圖，只顯示空狀態', () => {
    const { container } = render(
      <FundamentalTab fundamental={{ ...full, revenueMonths: [] }} loading={false} {...noCollapse} />,
    )
    expect(screen.getByText('查無月營收資料。')).toBeTruthy()
    expect(container.querySelector('.chart-wrap')).toBeNull()
  })
})
