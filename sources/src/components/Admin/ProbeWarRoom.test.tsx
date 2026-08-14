// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ProbeWarRoom } from './ProbeWarRoom'
import type { AdminStatus } from '../../services/adminStatus'

describe('ProbeWarRoom (盤後探針命中戰情室)', () => {
  afterEach(cleanup)

  const baseStatus: AdminStatus = {
    todayYmd: '20260814',
    asOf: '2026-08-14T17:25:00.000Z',
    manifest: { ymd: '20260814', dataDate: '2026-08-14', generatedAt: '2026-08-14T17:25:00.000Z' },
    chip: {
      ymd: '20260814',
      dataDate: '2026-08-14',
      sources: {
        institutional: { date: '2026-08-14', fetchedAt: '2026-08-14T15:15:00.000Z' },
        margin: null,
        borrow: null,
      },
    },
    coverage: { daily: 5, fundamental: 5, held: 5 },
    macro: { asOf: '2026-08-14T17:25:00.000Z', checkedAt: '2026-08-14T17:25:00.000Z', indicators: [] },
    fx: { asOf: '2026-08-14T17:25:00.000Z', count: 8 },
    market: {
      schema: 2,
      asOf: '2026-08-14T17:25:00.000Z',
      days: 120,
      latestDate: '2026-08-14',
      latestInstitutionalDate: '2026-08-14',
      missingInstitutional: 0,
      missingBuySell: 0,
      missingCandle: 0,
    },
    batch: { runsToday: 1, runSig: 'x' },
    probe: null,
    schedules: [],
    durationMs: 120,
    probeExperiment: {
      mode: 'probe-only',
      labels: {},
      order: [],
      ticks: [
        // BFI82U: 3 hits -> retired
        { taipei_ymd: '20260814', taipei_time: '15:05', source: 'bfi82u', hit: true, ok: true },
        { taipei_ymd: '20260814', taipei_time: '15:10', source: 'bfi82u', hit: true, ok: true },
        { taipei_ymd: '20260814', taipei_time: '15:15', source: 'bfi82u', hit: true, ok: true, note: '3次到位退休' },
        // T86: 1 hit, 1 miss -> probing (1/3)
        { taipei_ymd: '20260814', taipei_time: '15:30', source: 't86', hit: false, ok: true },
        { taipei_ymd: '20260814', taipei_time: '15:35', source: 't86', hit: true, ok: true },
        // MOPS revenue: 1 hit -> retired
        { taipei_ymd: '20260814', taipei_time: '17:15', source: 'mops_revenue', hit: true, ok: true },
      ],
    },
  }

  it('渲染戰情室標題與各來源戰情卡片', () => {
    const onRefresh = vi.fn()
    render(<ProbeWarRoom data={baseStatus} loading={false} onRefresh={onRefresh} />)

    expect(screen.getByText('盤後探針命中戰情室')).toBeTruthy()
    expect(screen.getByText('全市場三大法人')).toBeTruthy()
    expect(screen.getByText('個股三大法人')).toBeTruthy()
    expect(screen.getByText('個股估值 (PE/PB/DY)')).toBeTruthy()
    expect(screen.getByText('融資融券')).toBeTruthy()
    expect(screen.getByText('借券賣出餘額')).toBeTruthy()
  })

  it('正確計算已退休、探測中與待機狀態', () => {
    render(<ProbeWarRoom data={baseStatus} loading={false} onRefresh={vi.fn()} />)

    // BFI82U reaches 3 hits -> 已退休
    const bfiCard = screen.getByTestId('pwr-card-bfi82u')
    expect(bfiCard.textContent).toContain('✅ 已退休')
    expect(bfiCard.textContent).toContain('3/ 3 次到位')
    expect(bfiCard.textContent).toContain('15:05')
    expect(bfiCard.textContent).toContain('15:10')
    expect(bfiCard.textContent).toContain('15:15 退休')

    // T86 has 1 hit out of 3 -> 探測中 (1/3)
    const t86Card = screen.getByTestId('pwr-card-t86')
    expect(t86Card.textContent).toContain('🟢 探測中 (1/3)')
    expect(t86Card.textContent).toContain('1/ 3 次命中')
    expect(t86Card.textContent).toContain('15:35 最新')

    // Margin has 0 ticks -> 待機中
    const marginCard = screen.getByTestId('pwr-card-margin')
    expect(marginCard.textContent).toContain('⏳ 待機中')
    expect(marginCard.textContent).toContain('0/ 3 次命中')
    expect(marginCard.textContent).toContain('尚未進入時窗 (今日未命中)')
  })

  it('MOPS 營收 1 次命中即標記槽次收工', () => {
    render(<ProbeWarRoom data={baseStatus} loading={false} onRefresh={vi.fn()} />)
    const mopsCard = screen.getByTestId('pwr-card-mops_revenue')
    expect(mopsCard.textContent).toContain('✅ 槽次收工')
    expect(mopsCard.textContent).toContain('1/ 1 次到位')
    expect(mopsCard.textContent).toContain('17:15 退休')
  })
})
