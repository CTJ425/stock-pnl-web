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
    render(<FundamentalTab fundamental={withProfit} loading={false} />)
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
    const { unmount } = render(<FundamentalTab fundamental={withProfit} loading={false} />)
    const rows = document.querySelectorAll('.data-table')
    // 兩張表：獲利能力季度表 + 月營收表
    expect(rows).toHaveLength(2)
    const firstBodyRow = rows[0].querySelectorAll('tbody tr')[0]
    expect(firstBodyRow.textContent).toContain('2026 年第 1 季')
    unmount()

    const oneQuarter = { ...withProfit, profitQuarters: [withProfit.profitQuarters[1]] }
    render(<FundamentalTab fundamental={oneQuarter} loading={false} />)
    // 只剩月營收那張表；KPI 仍在
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
    // 沒有這行的話，畫面上少了幾個月時分不出是「資料就這樣」還是「你看到的是舊的一份」
    render(<FundamentalTab fundamental={full} loading={false} />)
    expect(screen.getByText(/資料更新於 2026-07-27 \d{2}:\d{2}（共 2 個月）/)).toBeTruthy()
  })

  it('產出時間與估值的「資料日」是兩個不同的東西，不可混為一談', () => {
    render(<FundamentalTab fundamental={full} loading={false} />)
    // 資料日 = 資料自己宣告的日期；資料更新於 = 我們抓到並寫檔的時刻
    expect(screen.getByText(/資料日 2026-07-24/)).toBeTruthy()
    expect(screen.getByText(/資料更新於 2026-07-27/)).toBeTruthy()
  })

  it('月營收表由新到舊列出並標示千元單位', () => {
    render(<FundamentalTab fundamental={full} loading={false} />)
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
      />,
    )
    // 本益比與殖利率各一個「—」
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
    // 前段只剩一個點（畫不出線）被丟棄，只留 05→06 那一段
    expect(container.querySelectorAll('.chart-wrap polyline')).toHaveLength(1)
  })

  it('查無月營收時不畫圖，只顯示空狀態', () => {
    const { container } = render(
      <FundamentalTab fundamental={{ ...full, revenueMonths: [] }} loading={false} />,
    )
    expect(screen.getByText('查無月營收資料。')).toBeTruthy()
    expect(container.querySelector('.chart-wrap')).toBeNull()
  })

  describe('獲利能力走勢圖（0.6.25）', () => {
    /** 由舊到新的 12 季（2023 Q2 → 2026 Q1）；毛利率逐季走高，用來釘住方向 */
    const twelve: ProfitQuarter[] = Array.from({ length: 12 }, (_, i) => {
      const q = 1 + i // 0 = 該年第 1 季，故 1 起算即 2023 Q2
      return {
        yearQuarter: `${2023 + Math.floor(q / 4)}-Q${(q % 4) + 1}`,
        revenueMillionTwd: 500000 + i * 20000,
        grossMarginPercent: 50 + i,
        operatingMarginPercent: 40 + i,
        pretaxMarginPercent: 42 + i,
        netMarginPercent: 35 + i,
      }
    })

    /** 獲利能力那張圖排在月營收之前（區塊順序：估值 → 獲利能力 → 月營收） */
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
      // 毛利率是第一條線，資料逐季走高 → SVG 的 y 應逐點變小
      const pts = (profitChart(container).querySelector('polyline')!.getAttribute('points') ?? '')
        .split(' ')
        .map((p) => Number(p.split(',')[1]))
      expect(pts[0]).toBeGreaterThan(pts[pts.length - 1])
      // 表格第一列仍是最新一季
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
      // 只剩月營收那張圖（X 軸標籤是 2026/05 這種帶斜線的月份）
      const wraps = container.querySelectorAll('.chart-wrap')
      expect(wraps).toHaveLength(1)
      expect(wraps[0].textContent).toContain('2026/05')
      // KPI 仍在，使用者不會覺得整段消失
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
      // 座標必須全是有限數（負值若讓值域算壞，這裡會冒出 NaN 而整條線消失）
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
      // 圖例本身不能跟著消失，否則就再也開不回來了
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
      // 四條線同軸時，值域要蓋到毛利率的 61 與稅後的 35
      expect(yTicks()).toContain('60')

      for (const name of ['毛利率', '營益率', '稅前純益率']) {
        await user.click(screen.getByRole('button', { name: new RegExp(name) }))
      }
      // 只剩稅後純益率（35–46）→ 60 那格刻度不再存在
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
      // 毛利率整條無值 → 該序列畫不出任何線段，只剩另外三條
      expect(profitChart(container).querySelectorAll('polyline')).toHaveLength(3)
      // 圖例仍列出毛利率（少了它會以為這檔股票沒有這個概念以外的原因）
      const labels = [...container.querySelectorAll('.chart-legend-label')].map(
        (e) => e.textContent,
      )
      expect(labels).toContain('毛利率')
    })
  })
})
