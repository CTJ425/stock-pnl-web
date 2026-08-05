// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FundamentalTab } from './FundamentalTab'
import type { FundamentalData, ProfitQuarter } from '../../services/fundamentalProxy'

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
        epsTwd: null,
      },
      {
        yearQuarter: '2026-Q1',
        revenueMillionTwd: 1134103.44,
        grossMarginPercent: 66.25,
        operatingMarginPercent: 58.1,
        pretaxMarginPercent: 60.65,
        netMarginPercent: 50.51,
        epsTwd: null,
      },
    ],
  }

  it('獲利能力四格 KPI 取最新一季', () => {
    render(<FundamentalTab fundamental={withProfit} loading={false} />)
    // "Gross profit margin" is both the KPI label and header, so the comparison is limited to the KPI block.
    const labels = [...document.querySelectorAll('.kpi-label')].map((e) => e.textContent)
    expect(labels).toEqual(
      expect.arrayContaining(['毛利率', '營益率', '稅前純益率', '稅後純益率']),
    )
    // The value also appears in both the KPI and the table, so it is also limited to the KPI block
    const values = [...document.querySelectorAll('.kpi-value')].map((e) => e.textContent)
    expect(values).toEqual(
      expect.arrayContaining(['+66.25%', '+58.10%', '+60.65%', '+50.51%']),
    )
    expect(screen.getByText(/2026 年第 1 季（已累積 2 季）/)).toBeTruthy()
  })

  it('季度趨勢表由新到舊，且只有一季時不出現表格', () => {
    const { unmount } = render(<FundamentalTab fundamental={withProfit} loading={false} />)
    const rows = document.querySelectorAll('.data-table')
    // Two tables: quarterly profitability table + monthly revenue table
    expect(rows).toHaveLength(2)
    const firstBodyRow = rows[0].querySelectorAll('tbody tr')[0]
    expect(firstBodyRow.textContent).toContain('2026 年第 1 季')
    unmount()

    const oneQuarter = { ...withProfit, profitQuarters: [withProfit.profitQuarters[1]] }
    render(<FundamentalTab fundamental={oneQuarter} loading={false} />)
    // Only the monthly revenue table remains; KPIs are still there
    expect(document.querySelectorAll('.data-table')).toHaveLength(1)
    expect(screen.getByText('+66.25%')).toBeTruthy()
  })

  it('沒有獲利能力資料時顯示空狀態，不影響其他區塊', () => {
    render(<FundamentalTab fundamental={full} loading={false} />)
    expect(screen.getByText('查無獲利能力資料。')).toBeTruthy()
    expect(screen.getByText('31.59')).toBeTruthy()
  })

  it('顯示估值三指標與資料日期', () => {
    render(<FundamentalTab fundamental={full} loading={false} />)
    expect(screen.getByText('31.59')).toBeTruthy()
    expect(screen.getByText('0.94%')).toBeTruthy()
    expect(screen.getByText('10.34')).toBeTruthy()
    expect(screen.getByText(/資料日 2026-07-24/)).toBeTruthy()
  })

  it('標示這份資料是我們何時產出的，以及一共幾個月', () => {
    // Without this line, when a few months are missing from the screen, it would be impossible to tell whether "the data is just like this" or "what you are seeing is an old copy."
    render(<FundamentalTab fundamental={full} loading={false} />)
    expect(screen.getByText(/資料更新於 2026-07-27 \d{2}:\d{2}（共 2 個月）/)).toBeTruthy()
  })

  it('產出時間與估值的「資料日」是兩個不同的東西，不可混為一談', () => {
    render(<FundamentalTab fundamental={full} loading={false} />)
    // Data date = the date the data was announced by itself; data updated = the time we captured and documented it
    expect(screen.getByText(/資料日 2026-07-24/)).toBeTruthy()
    expect(screen.getByText(/資料更新於 2026-07-27/)).toBeTruthy()
  })

  it('月營收表由新到舊列出並標示千元單位', () => {
    render(<FundamentalTab fundamental={full} loading={false} />)
    expect(screen.getByText('單位：千元')).toBeTruthy()
    const rows = screen.getAllByRole('row')
    // rows[0] is the header; the first column of data should be the latest month
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
      />,
    )
    // The price-to-earnings ratio and yield rate each have a "—"
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('查無月營收資料。')).toBeTruthy()
  })

  it('查無資料時顯示「尚未產生」空狀態', () => {
    render(<FundamentalTab fundamental={null} loading={false} />)
    expect(screen.getByText('基本面資料尚未產生')).toBeTruthy()
  })

  it('載入中顯示讀取提示', () => {
    render(<FundamentalTab fundamental={null} loading={true} />)
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
      />,
    )
    expect(screen.getByText(/可能為上櫃股票/)).toBeTruthy()
    expect(screen.getByText('查無估值資料。')).toBeTruthy()
  })

  it('月營收有走勢圖，且方向與表格相反（圖由舊到新、表由新到舊）', () => {
    const { container } = render(<FundamentalTab fundamental={full} loading={false} />)
    const poly = container.querySelector('.chart-wrap polyline')
    expect(poly).toBeTruthy()

    /*
      The chart must run oldest to newest. Source: revenueMonths goes May → June (old → new), while the table is
      deliberately reversed to new → old —— if the chart took the wrong one the line would run backwards **and
      still look plausible** (the trend exactly inverted), the hardest kind of bug to notice, so the direction is
      pinned by y coordinate.
    */
    const [p1, p2] = (poly!.getAttribute('points') ?? '').split(' ')
    const y = (pt: string) => Number(pt.split(',')[1])
    // Revenue in May is lower → y is larger (SVG’s y increases downward)
    expect(y(p1)).toBeGreaterThan(y(p2))
  })

  it('走勢圖的 X 軸標籤帶年份（跨年時才分得出是哪一年）', () => {
    const { container } = render(<FundamentalTab fundamental={full} loading={false} />)
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
    const { container } = render(<FundamentalTab fundamental={gap} loading={false} />)
    // There is only one point left in the previous section (no line can be drawn) and is discarded, leaving only the section 05→06.
    expect(container.querySelectorAll('.chart-wrap polyline')).toHaveLength(1)
  })

  it('查無月營收時不畫圖，只顯示空狀態', () => {
    const { container } = render(
      <FundamentalTab fundamental={{ ...full, revenueMonths: [] }} loading={false} />,
    )
    expect(screen.getByText('查無月營收資料。')).toBeTruthy()
    expect(container.querySelector('.chart-wrap')).toBeNull()
  })

  describe('每股盈餘（0.6.28）', () => {
    const eps = (yearQuarter: string, epsTwd: number | null): ProfitQuarter => ({
      yearQuarter,
      revenueMillionTwd: 500000,
      grossMarginPercent: 55,
      operatingMarginPercent: 45,
      pretaxMarginPercent: 47,
      netMarginPercent: 40,
      epsTwd,
    })

    it('KPI 與表格都顯示 EPS，單位是元且不帶正號', () => {
      render(
        <FundamentalTab
          fundamental={{ ...full, profitQuarters: [eps('2025-Q4', 12.5), eps('2026-Q1', 13.94)] }}
          loading={false}
        />,
      )
      const values = [...document.querySelectorAll('.kpi-value')].map((e) => e.textContent)
      // 13.94 yuan, not +13.94% (EPS is the amount, with a positive sign it will be read as an increase or decrease)
      expect(values).toContain('13.94 元')
      expect(document.querySelectorAll('.data-table')[0].textContent).toContain('12.50 元')
    })

    it('最新一季還沒有 EPS 時退回最近一筆有的，並說明是哪一季', () => {
      // The ratio is updated every night, and EPS has to wait for the quarterly report to be replenished. In the intervening days, there is no EPS in the latest quarter.
      render(
        <FundamentalTab
          fundamental={{ ...full, profitQuarters: [eps('2025-Q4', 12.5), eps('2026-Q1', null)] }}
          loading={false}
        />,
      )
      const values = [...document.querySelectorAll('.kpi-value')].map((e) => e.textContent)
      expect(values).toContain('12.50 元')
      expect(screen.getByText(/最近有數字的是 2025 年第 4 季/)).toBeTruthy()
    })

    it('完全沒有 EPS 時顯示「—」而不是 0，也不畫 EPS 圖', () => {
      const { container } = render(
        <FundamentalTab
          fundamental={{ ...full, profitQuarters: [eps('2025-Q4', null), eps('2026-Q1', null)] }}
          loading={false}
        />,
      )
      const values = [...document.querySelectorAll('.kpi-value')].map((e) => e.textContent)
      expect(values).toContain('—')
      // Two pictures: fourth line of profitability + monthly revenue; the one without EPS
      expect(container.querySelectorAll('.chart-wrap')).toHaveLength(2)
    })

    it('EPS 圖只畫有數字的季，缺的那幾季不畫成斷線', () => {
      const { container } = render(
        <FundamentalTab
          fundamental={{
            ...full,
            profitQuarters: [
              eps('2025-Q3', 11.4),
              eps('2025-Q4', null),
              eps('2026-Q1', 13.94),
            ],
          }}
          loading={false}
        />,
      )
      // Three pictures: fourth line + EPS + monthly revenue
      const wraps = container.querySelectorAll('.chart-wrap')
      expect(wraps).toHaveLength(3)
      // The EPS picture only has two points connected into one section, not three points that "fall off in the middle"
      const epsChart = wraps[1]
      expect(epsChart.querySelectorAll('circle')).toHaveLength(2)
      expect(epsChart.querySelectorAll('polyline')).toHaveLength(1)
    })
  })

  describe('獲利能力走勢圖（0.6.25）', () => {
    /** 12 quarters from old to new (2023 Q2 → 2026 Q1); gross profit margin increases quarter by quarter, used to pin the direction*/
    const twelve: ProfitQuarter[] = Array.from({ length: 12 }, (_, i) => {
      const q = 1 + i // 0 = 該年第 1 季，故 1 起算即 2023 Q2
      return {
        yearQuarter: `${2023 + Math.floor(q / 4)}-Q${(q % 4) + 1}`,
        revenueMillionTwd: 500000 + i * 20000,
        grossMarginPercent: 50 + i,
        operatingMarginPercent: 40 + i,
        pretaxMarginPercent: 42 + i,
        netMarginPercent: 35 + i,
        epsTwd: null,
      }
    })

    /** The profitability chart is ranked before monthly revenue (block sequence: Valuation → Profitability → Monthly Revenue)*/
    const profitChart = (c: HTMLElement) => c.querySelectorAll('.chart-wrap')[0]
    const withQuarters = (profitQuarters: ProfitQuarter[]): FundamentalData => ({
      ...full,
      profitQuarters,
    })

    it('四項比率各一條線，圖例四項且順序與損益表一致', () => {
      const { container } = render(
        <FundamentalTab fundamental={withQuarters(twelve)} loading={false} />,
      )
      expect(profitChart(container).querySelectorAll('polyline')).toHaveLength(4)

      const labels = [...container.querySelectorAll('.chart-legend-label')].map(
        (e) => e.textContent,
      )
      expect(labels).toEqual(['毛利率', '營益率', '稅前純益率', '稅後純益率'])
    })

    it('圖由舊到新（與表格的新→舊相反）', () => {
      const { container } = render(
        <FundamentalTab fundamental={withQuarters(twelve)} loading={false} />,
      )
      // Gross profit margin is the first line, and the data is getting higher quarter by quarter → SVG's y should become smaller point by point
      const pts = (profitChart(container).querySelector('polyline')!.getAttribute('points') ?? '')
        .split(' ')
        .map((p) => Number(p.split(',')[1]))
      expect(pts[0]).toBeGreaterThan(pts[pts.length - 1])
      // The first column of the table is still the latest season
      expect(container.querySelectorAll('.data-table tbody tr')[0].textContent).toContain(
        '2026 年第 1 季',
      )
    })

    it('12 季的 X 軸隔一季標一個，年份只留末兩碼', () => {
      const { container } = render(
        <FundamentalTab fundamental={withQuarters(twelve)} loading={false} />,
      )
      const ticks = [...profitChart(container).querySelectorAll('svg text')]
        .map((t) => t.textContent ?? '')
        .filter((t) => /^\d{2}Q\d$/.test(t))
      expect(ticks).toEqual(['23Q2', '23Q4', '24Q2', '24Q4', '25Q2', '25Q4'])
    })

    it('只有一季時不畫圖：一個點連不出線段，只會留下一張空座標軸', () => {
      const { container } = render(
        <FundamentalTab fundamental={withQuarters([twelve[11]])} loading={false} />,
      )
      // Only the monthly revenue chart is left (the X-axis label is the month with a slash like 2026/05)
      const wraps = container.querySelectorAll('.chart-wrap')
      expect(wraps).toHaveLength(1)
      expect(wraps[0].textContent).toContain('2026/05')
      // The KPI is still there, and users won’t feel like the whole section has disappeared.
      expect(screen.getByText('+61.00%')).toBeTruthy()
    })

    it('虧損季的負值不破圖，四條線照畫', () => {
      const loss = twelve.map((q, i) =>
        i >= 6
          ? { ...q, operatingMarginPercent: -3.5, pretaxMarginPercent: -4.2, netMarginPercent: -5.1 }
          : q,
      )
      const { container } = render(
        <FundamentalTab fundamental={withQuarters(loss)} loading={false} />,
      )
      const polylines = profitChart(container).querySelectorAll('polyline')
      expect(polylines).toHaveLength(4)
      // The coordinates must all be finite numbers (if the negative value makes the range calculation bad, NaN will appear here and the entire line will disappear)
      const coords = [...polylines]
        .flatMap((p) => (p.getAttribute('points') ?? '').split(' '))
        .flatMap((pt) => pt.split(',').map(Number))
      expect(coords.every((n) => Number.isFinite(n))).toBe(true)
    })

    it('點圖例可以把那條線關掉，再點一次回來', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <FundamentalTab fundamental={withQuarters(twelve)} loading={false} />,
      )
      const gross = screen.getByRole('button', { name: /毛利率/ })
      expect(gross.getAttribute('aria-pressed')).toBe('true')

      await user.click(gross)
      expect(gross.getAttribute('aria-pressed')).toBe('false')
      expect(profitChart(container).querySelectorAll('polyline')).toHaveLength(3)
      // The legend itself cannot disappear, otherwise it will never be opened again.
      expect(screen.getByRole('button', { name: /毛利率/ })).toBeTruthy()

      await user.click(gross)
      expect(profitChart(container).querySelectorAll('polyline')).toHaveLength(4)
    })

    it('只留一條時 Y 軸依它重算（這才是「只看單一項」的重點）', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <FundamentalTab fundamental={withQuarters(twelve)} loading={false} />,
      )
      const yTicks = () =>
        [...profitChart(container).querySelectorAll('svg text')]
          .map((t) => t.textContent ?? '')
          .filter((t) => /^-?\d+$/.test(t))
      // When the four lines are coaxial, the value range should cover 61 of gross profit margin and 35 of after tax.
      expect(yTicks()).toContain('60')

      for (const name of ['毛利率', '營益率', '稅前純益率']) {
        await user.click(screen.getByRole('button', { name: new RegExp(name) }))
      }
      // Only the after-tax net profit ratio (35–46) → 60 grid no longer exists
      expect(profitChart(container).querySelectorAll('polyline')).toHaveLength(1)
      expect(yTicks()).not.toContain('60')
    })

    it('最後一條可見的線不給關（全部關掉只會剩空座標軸）', async () => {
      const user = userEvent.setup()
      render(<FundamentalTab fundamental={withQuarters(twelve)} loading={false} />)
      for (const name of ['毛利率', '營益率', '稅前純益率']) {
        await user.click(screen.getByRole('button', { name: new RegExp(name) }))
      }
      const last = screen.getByRole('button', { name: /稅後純益率/ })
      expect(last.hasAttribute('disabled')).toBe(true)
      await user.click(last)
      expect(last.getAttribute('aria-pressed')).toBe('true')
    })

    it('金融業沒有毛利率：那條線斷開，其餘三條照常', () => {
      const bank = twelve.map((q) => ({ ...q, grossMarginPercent: null }))
      const { container } = render(
        <FundamentalTab fundamental={withQuarters(bank)} loading={false} />,
      )
      // The entire gross profit margin line has no value → no line segments can be drawn in this sequence, only three other lines are left.
      expect(profitChart(container).querySelectorAll('polyline')).toHaveLength(3)
      // The legend still lists the gross profit margin (without it for reasons other than thinking that this stock does not have this concept)
      const labels = [...container.querySelectorAll('.chart-legend-label')].map(
        (e) => e.textContent,
      )
      expect(labels).toContain('毛利率')
    })
  })
})
