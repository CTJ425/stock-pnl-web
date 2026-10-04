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
        { taipei_ymd: '20260814', taipei_time: '15:05', source: 'bfi82u', hit: true, ok: true, fingerprint: 'fp-a' },
        { taipei_ymd: '20260814', taipei_time: '15:10', source: 'bfi82u', hit: true, ok: true, fingerprint: 'fp-a' },
        { taipei_ymd: '20260814', taipei_time: '15:15', source: 'bfi82u', hit: true, ok: true, fingerprint: 'fp-a', note: '3次到位退休' },
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
    // Each source appears twice: its timeline row and its card under the timeline.
    for (const name of ['全市場三大法人', '個股三大法人', '個股估值 (PE/PB/DY)', '融資融券', '借券賣出餘額']) {
      expect(screen.getAllByText(name)).toHaveLength(2)
    }
    expect(screen.getByTestId('pwr-timeline').querySelectorAll('.pwr-tl-row')).toHaveLength(8)
  })

  it('抬頭統計用「收工」一詞，同時涵蓋退休與六槽跑完（Task 133）', () => {
    render(<ProbeWarRoom data={baseStatus} loading={false} onRefresh={vi.fn()} />)
    expect(screen.getByText(/收工 1 源・探測中 2 源・待機中 5 源/)).toBeTruthy()
  })

  // The empty-card label reads the wall clock (AD-10), so pin it: this used to fail every night
  // after 22:30 Taipei, when the 融資融券 window had closed and the label changed.
  function atTaipei(hhmm: string) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`2026-08-14T${hhmm}:00+08:00`))
  }
  afterEach(() => {
    vi.useRealTimers()
  })

  it('正確計算已退休、探測中與待機狀態', () => {
    atTaipei('17:30')
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

  // Task 193 M19: the server retires a source after 3 TRAILING hits with the SAME fingerprint, counted
  // only inside the window that is active now (`summariseLandedTicks`, `REQUIRED_LANDED_COUNTS`). The
  // card used to retire at "3 hits today", so it said 收工 while the server was still probing.
  describe('收工判準與伺服器一致', () => {
    const withTicks = (ticks: NonNullable<AdminStatus['probeExperiment']>['ticks'], asOf: string): AdminStatus => ({
      ...baseStatus,
      asOf,
      probeExperiment: { mode: 'probe-only', labels: {}, order: [], ticks },
    })
    const tick = (time: string, fp: string | null) => ({
      taipei_ymd: '20260814',
      taipei_time: time,
      source: 'bfi82u',
      hit: true,
      ok: true,
      fingerprint: fp,
    })
    // 2026-08-14T12:00Z = 20:00 Taipei, inside bfi82u's second window (19:30–20:15).
    const EVENING = '2026-08-14T12:00:00.000Z'

    it('three hits with a changing fingerprint are not retired: the upstream is still moving', () => {
      render(
        <ProbeWarRoom
          data={withTicks([tick('19:35', 'a'), tick('19:40', 'b'), tick('19:45', 'c')], EVENING)}
          loading={false}
          onRefresh={vi.fn()}
        />,
      )
      const card = screen.getByTestId('pwr-card-bfi82u')
      expect(card.textContent).not.toContain('已退休')
      expect(card.textContent).toContain('🟢 探測中')
    })

    it('hits spread over the two windows do not add up to a retirement', () => {
      // Two in the 15:00–16:30 window, one in the evening window, all the same content. Only the active
      // (evening) window counts, so this is one landing, not three.
      render(
        <ProbeWarRoom
          data={withTicks([tick('15:05', 'a'), tick('15:10', 'a'), tick('19:35', 'a')], EVENING)}
          loading={false}
          onRefresh={vi.fn()}
        />,
      )
      expect(screen.getByTestId('pwr-card-bfi82u').textContent).not.toContain('已退休')
    })

    it('three identical landings inside the active window retire it', () => {
      render(
        <ProbeWarRoom
          data={withTicks([tick('19:35', 'a'), tick('19:40', 'a'), tick('19:45', 'a')], EVENING)}
          loading={false}
          onRefresh={vi.fn()}
        />,
      )
      expect(screen.getByTestId('pwr-card-bfi82u').textContent).toContain('✅ 已退休')
    })

    it('takes the windows and the retire count from the server plan, not a second copy', () => {
      render(<ProbeWarRoom data={baseStatus} loading={false} onRefresh={vi.fn()} />)
      expect(screen.getByTestId('pwr-card-bfi82u').textContent).toContain('15:00–16:30 / 19:30–20:15')
      expect(screen.getByTestId('pwr-card-borrow').textContent).toContain('21:00–23:30')
    })
  })

  it('空卡片依融資融券時窗（20:30–22:30）區分三種狀態', () => {
    for (const [hhmm, label] of [
      ['17:30', '尚未進入時窗 (今日未命中)'],
      ['21:00', '時窗內尚未命中'],
      ['23:45', '今日已結束，未命中'],
    ] as const) {
      atTaipei(hhmm)
      render(<ProbeWarRoom data={baseStatus} loading={false} onRefresh={vi.fn()} />)
      expect(screen.getByTestId('pwr-card-margin').textContent).toContain(label)
      cleanup()
    }
  })

  /*
    MOPS 兩源永不退休（Task 133）：命中不收工，平日六個槽點全跑。
    卡片的進度分子因此是「今日已跑的槽數」，不是命中次數——命中次數在不退休的來源上
    不再是任何判準，拿它當分子會讓「跑了幾槽」這件唯一在量的事看不出來。
  */
  it('MOPS 命中不退休：顯示槽次進度，卡片不得出現退休／收工字樣', () => {
    render(<ProbeWarRoom data={baseStatus} loading={false} onRefresh={vi.fn()} />)
    const mopsCard = screen.getByTestId('pwr-card-mops_revenue')
    expect(mopsCard.textContent).toContain('🟢 探測中 (1/6 槽)')
    expect(mopsCard.textContent).toContain('1/ 6 槽')
    expect(mopsCard.textContent).not.toContain('退休')
    expect(mopsCard.textContent).not.toContain('收工')

    // 今日尚未跑到任何槽 -> 待機中
    const profitCard = screen.getByTestId('pwr-card-mops_profit')
    expect(profitCard.textContent).toContain('⏳ 待機中')
    expect(profitCard.textContent).toContain('0/ 6 槽')
  })

  it('MOPS 六槽跑完標記「六槽跑完」，而不是退休，也不再標「最新」', () => {
    const sixSlots: AdminStatus = {
      ...baseStatus,
      probeExperiment: {
        mode: 'probe-only',
        labels: {},
        order: [],
        ticks: ['12:00', '12:05', '17:15', '17:20', '21:00', '21:05'].map((t) => ({
          taipei_ymd: '20260814',
          taipei_time: t,
          source: 'mops_profit',
          hit: true,
          ok: true,
        })),
      },
    }
    render(<ProbeWarRoom data={sixSlots} loading={false} onRefresh={vi.fn()} />)
    const profitCard = screen.getByTestId('pwr-card-mops_profit')
    expect(profitCard.textContent).toContain('✅ 六槽跑完')
    expect(profitCard.textContent).toContain('6/ 6 槽')
    expect(profitCard.textContent).not.toContain('退休')
    expect(profitCard.textContent).not.toContain('最新')
  })

  it('日頻來源第 1 次與第 2 次命中（即使 tick note 含有「資料已到位」）不可過早標記退休，唯有滿 3 次才退休', () => {
    // 第一次命中：應為 🟢 探測中 (1/3)，晶片顯示「15:35 最新」，不可為「退休」
    const status1Hit: AdminStatus = {
      ...baseStatus,
      probeExperiment: {
        mode: 'probe-only',
        labels: {},
        order: [],
        ticks: [
          {
            taipei_ymd: '20260814',
            taipei_time: '15:35',
            source: 't86',
            fingerprint: 'fp-t86',
            hit: true,
            ok: true,
            note: '當日三大法人有表 · 已觸發 generate-chips：產出 5 檔 · 資料已到位',
          },
        ],
      },
    }
    const { unmount: unmount1 } = render(<ProbeWarRoom data={status1Hit} loading={false} onRefresh={vi.fn()} />)
    const t86Card1 = screen.getByTestId('pwr-card-t86')
    expect(t86Card1.textContent).toContain('🟢 探測中 (1/3)')
    expect(t86Card1.textContent).not.toContain('已退休')
    expect(t86Card1.textContent).toContain('1/ 3 次命中')
    expect(t86Card1.textContent).toContain('15:35 最新')
    expect(t86Card1.textContent).not.toContain('15:35 退休')
    unmount1()

    // 第二次命中：應為 🟢 探測中 (2/3)，晶片顯示「15:35  15:40 最新」
    const status2Hits: AdminStatus = {
      ...baseStatus,
      probeExperiment: {
        mode: 'probe-only',
        labels: {},
        order: [],
        ticks: [
          {
            taipei_ymd: '20260814',
            taipei_time: '15:35',
            source: 't86',
            fingerprint: 'fp-t86',
            hit: true,
            ok: true,
            note: '當日三大法人有表 · 已觸發 generate-chips：產出 5 檔 · 資料已到位',
          },
          {
            taipei_ymd: '20260814',
            taipei_time: '15:40',
            source: 't86',
            fingerprint: 'fp-t86',
            hit: true,
            ok: true,
            note: '當日三大法人有表 · 已觸發 generate-chips：產出 5 檔 · 資料已到位',
          },
        ],
      },
    }
    const { unmount: unmount2 } = render(<ProbeWarRoom data={status2Hits} loading={false} onRefresh={vi.fn()} />)
    const t86Card2 = screen.getByTestId('pwr-card-t86')
    expect(t86Card2.textContent).toContain('🟢 探測中 (2/3)')
    expect(t86Card2.textContent).not.toContain('已退休')
    expect(t86Card2.textContent).toContain('2/ 3 次命中')
    expect(t86Card2.textContent).toContain('15:35')
    expect(t86Card2.textContent).toContain('15:40 最新')
    expect(t86Card2.textContent).not.toContain('15:40 退休')
    unmount2()

    // 第三次命中：滿 3 次到位，右上角顯示「✅ 已退休」，晶片顯示「15:45 退休」
    const status3Hits: AdminStatus = {
      ...baseStatus,
      probeExperiment: {
        mode: 'probe-only',
        labels: {},
        order: [],
        ticks: [
          {
            taipei_ymd: '20260814',
            taipei_time: '15:35',
            source: 't86',
            fingerprint: 'fp-t86',
            hit: true,
            ok: true,
            note: '當日三大法人有表 · 已觸發 generate-chips：產出 5 檔 · 資料已到位',
          },
          {
            taipei_ymd: '20260814',
            taipei_time: '15:40',
            source: 't86',
            fingerprint: 'fp-t86',
            hit: true,
            ok: true,
            note: '當日三大法人有表 · 已觸發 generate-chips：產出 5 檔 · 資料已到位',
          },
          {
            taipei_ymd: '20260814',
            taipei_time: '15:45',
            source: 't86',
            fingerprint: 'fp-t86',
            hit: true,
            ok: true,
            note: '當日三大法人有表 · 已觸發 generate-chips：產出 5 檔 · 資料已到位',
          },
        ],
      },
    }
    const { unmount: unmount3 } = render(<ProbeWarRoom data={status3Hits} loading={false} onRefresh={vi.fn()} />)
    const t86Card3 = screen.getByTestId('pwr-card-t86')
    expect(t86Card3.textContent).toContain('✅ 已退休')
    expect(t86Card3.textContent).toContain('3/ 3 次到位')
    expect(t86Card3.textContent).toContain('15:35')
    expect(t86Card3.textContent).toContain('15:40')
    expect(t86Card3.textContent).toContain('15:45 退休')
    unmount3()
  })
})
