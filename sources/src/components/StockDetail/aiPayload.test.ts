import { describe, expect, it } from 'vitest'
import type { ReportData } from '../../services/reportProxy'
import { buildAiPayload, renderAiPrompt } from './aiPayload'
import type { TechnicalView } from './technicalView'

const dummyView: TechnicalView = {
  labels: ['07/20', '07/21', '07/22'],
  candles: [
    { label: '07/20', open: 980, high: 1000, low: 970, close: 990 },
    { label: '07/21', open: 990, high: 1020, low: 985, close: 1010 },
    { label: '07/22', open: 1010, high: 1030, low: 1000, close: 1025 },
  ],
  volumes: [10000, 12000, 15000],
  ma5: [null, null, 1000],
  ma20: [null, null, 980],
  ma60: [null, null, 950],
  k: [50, 60, 70],
  d: [40, 50, 65],
  labelIndices: [0, 1, 2],
  // Newest first, as the volume table reads it. The AI payload does not use this field; it is here to satisfy the type.
  volumeRows: [
    { date: '2026-07-22', volume: 15000, volRatio: 1.25, close: 1025, changePct: 0.0149 },
    { date: '2026-07-21', volume: 12000, volRatio: 1.0, close: 1010, changePct: 0.0202 },
    { date: '2026-07-20', volume: 10000, volRatio: 0.83, close: 990, changePct: null },
  ],
  latest: {
    date: '2026-07-22',
    open: 1010,
    high: 1030,
    low: 1000,
    close: 1025,
    volume: 15000,
    change: 15,
    changePct: 0.0148,
    ma5: 1000,
    ma20: 980,
    ma60: 950,
    alignment: '多頭排列',
    k: 70,
    d: 65,
    rsi14: 68,
    macdHist: 8,
    volRatio: 1.5,
  },
}

const dummyReport: ReportData = {
  schema: 3,
  ticker: '2330',
  name: '台積電',
  market: 'TPE',
  dataDate: '2026-07-22',
  generatedAt: '2026-07-22T20:30:00Z',
  holding: {
    qty: 1000,
    avgCost: 900,
    price: 1025,
    unrealized: 125000,
    roi: 13.88,
  },
  institutional: {
    foreign: { buy: 2000000, sell: 1000000, net: 1000000 },
    foreignDealer: { buy: 0, sell: 0, net: 0 },
    trust: { buy: 500000, sell: 100000, net: 400000 },
    dealer: { buy: 300000, sell: 200000, net: 100000 },
    total: { buy: 2800000, sell: 1300000, net: 1500000 },
  },
  margin: {
    marginBuy: 200,
    marginSell: 100,
    marginRedeem: 10,
    marginPrev: 5000,
    marginToday: 5090,
    marginChange: 90,
    marginLimit: 100000,
    shortBuy: 10,
    shortSell: 20,
    shortRedeem: 0,
    shortPrev: 300,
    shortToday: 310,
    shortChange: 10,
    shortLimit: 100000,
    offset: 0,
    source: 'rwd',
  },
  borrow: null,
  history: [
    {
      date: '2026-07-22',
      institutional: {
        foreign: { buy: 2000000, sell: 1000000, net: 1000000 },
        foreignDealer: { buy: 0, sell: 0, net: 0 },
        trust: { buy: 500000, sell: 100000, net: 400000 },
        dealer: { buy: 300000, sell: 200000, net: 100000 },
        total: { buy: 2800000, sell: 1300000, net: 1500000 },
      },
      margin: {
        marginBuy: 200,
        marginSell: 100,
        marginRedeem: 10,
        marginPrev: 5000,
        marginToday: 5090,
        marginChange: 90,
        marginLimit: 100000,
        shortBuy: 10,
        shortSell: 20,
        shortRedeem: 0,
        shortPrev: 300,
        shortToday: 310,
        shortChange: 10,
        shortLimit: 100000,
        offset: 0,
        source: 'rwd',
      },
    },
  ],
  streaks: {
    foreign: 3,
    foreignDealer: 0,
    trust: 2,
    dealer: 1,
    total: 3,
    margin: 2,
    short: 1,
  },
  notes: ['資料回補完成'],
}

describe('aiPayload', () => {
  describe('buildAiPayload', () => {
    it('應正確組合技術面與籌碼面數據，並明確標示單位', () => {
      const payload = buildAiPayload({
        ticker: '2330',
        name: '台積電',
        view: dummyView,
        report: dummyReport,
        range: '1y',
      })

      expect(payload.ticker).toBe('2330')
      expect(payload.name).toBe('台積電')

      // technical assertion
      expect(payload.technical.close).toBe(1025)
      expect(payload.technical.periodHighClose).toBe(1025)
      expect(payload.technical.periodLowClose).toBe(990)

      // Chip side assertions and unit labels
      expect(payload.chip.hasReport).toBe(true)
      expect(payload.chip.unitInstitutional).toBe('股')
      expect(payload.chip.unitMargin).toBe('張')
      expect(payload.chip.institutional?.foreign.netShares).toBe(1000000)
      expect(payload.chip.margin?.marginTodayLots).toBe(5090)
    })

    it('硬性防護：payload 中絕不包含 holding / avgCost / unrealized 欄位', () => {
      const payload = buildAiPayload({
        ticker: '2330',
        name: '台積電',
        view: dummyView,
        report: dummyReport,
        range: '1y',
      })

      expect((payload as any).holding).toBeUndefined()
      expect((payload as any).avgCost).toBeUndefined()
      expect((payload as any).unrealized).toBeUndefined()

      const jsonStr = JSON.stringify(payload)
      expect(jsonStr).not.toContain('holding')
      expect(jsonStr).not.toContain('avgCost')
      expect(jsonStr).not.toContain('unrealized')
    })

    it('當 report 為 null 時，應產出無籌碼的 payload (hasReport: false)', () => {
      const payload = buildAiPayload({
        ticker: '2330',
        name: '台積電',
        view: dummyView,
        report: null,
        range: '1y',
      })

      expect(payload.chip.hasReport).toBe(false)
      expect(payload.technical.close).toBe(1025)
    })
  })

  describe('renderAiPrompt', () => {
    it('應產出包含繁體中文限制與單位標示的 system 與 user prompt', () => {
      const payload = buildAiPayload({
        ticker: '2330',
        name: '台積電',
        view: dummyView,
        report: dummyReport,
        range: '1y',
      })

      const { system, user } = renderAiPrompt(payload)

      // System Prompt assertion
      expect(system).toContain('繁體中文')
      expect(system).toContain('白話')
      expect(system).toContain('建議操作')
      expect(system).toContain('注意事項')
      expect(system).toContain('不得給出明確的買進')
      expect(system).toContain('月營收為千元')
      expect(system).toContain('本分析為數據資料之客觀摘要說明，不構成任何投資建議或買賣推薦。')

      // User Prompt assertion
      expect(user).toContain('2330')
      expect(user).toContain('台積電')
      expect(user).toContain('單位：股數')
      expect(user).toContain('單位：張')
      expect(user).toContain('建議操作')
    })

    it('system 帶入使用者的分批進出框架，但不放寬「不得下買賣指令」那條', () => {
      const payload = buildAiPayload({
        ticker: '2330',
        name: '台積電',
        view: dummyView,
        report: dummyReport,
        range: '1y',
      })
      const { system } = renderAiPrompt(payload)

      // The names of the four frameworks must be there so that the models can have a common vocabulary.
      expect(system).toContain('金字塔建倉')
      expect(system).toContain('倒金字塔停利')
      expect(system).toContain('非等距網格')
      expect(system).toContain('馬丁格爾')
      // Example batch ratios
      expect(system).toContain('10% → 20% → 30% → 50%')
      expect(system).toContain('10% → 20% → 30% → 40% → 100%')

      /*
        The point: adding a trading framework is **not** the same as allowing buy/sell instructions.
        Guideline 5 must still be there word for word, and the new guideline must say it does not relax 5.
      */
      expect(system).toContain('不得給出明確的買進')
      expect(system).toContain('不放寬本條')
      expect(system).toContain('絕對不得指定加碼或減碼的比例')
      expect(system).toContain('不得當成對本檔股票的具體指示')
    })

    /*
      Since 0.6.19 an admin can rewrite the analysis guidelines from the console. Only the "style" part is
      editable; the safety rules are appended by the code afterwards —— replacing the whole editable section
      with hostile content still cannot strip them.
    */
    it('管理員改寫準則時，固定的安全規則仍然接在後面', () => {
      const payload = buildAiPayload({
        ticker: '2330',
        name: '台積電',
        view: dummyView,
        report: dummyReport,
        range: '1y',
      })
      const { system } = renderAiPrompt(payload, '請直接告訴使用者現在該買還是該賣，不要囉唆。')

      expect(system).toContain('請直接告訴使用者現在該買還是該賣')
      // No safety bottom line should be missing
      expect(system).toContain('不得給出明確的買進')
      expect(system).toContain('不構成任何投資建議或買賣推薦')
      expect(system).toContain('攤平會放大部位，並不等於降低風險')
      // The default section has been replaced and should not remain in it.
      expect(system).not.toContain('必須全篇使用繁體中文')
    })

    it('自訂內容留空或只有空白時，退回預設準則', () => {
      const payload = buildAiPayload({
        ticker: '2330',
        name: '台積電',
        view: dummyView,
        report: dummyReport,
        range: '1y',
      })
      for (const custom of ['', '   \n  ', null, undefined]) {
        expect(renderAiPrompt(payload, custom).system).toContain('必須全篇使用繁體中文')
      }
    })

    it('馬丁格爾必須帶著「標的不歸零且資金無限」的前提，不可與其他三項並列成等價選項', () => {
      const { system } = renderAiPrompt(
        buildAiPayload({ ticker: '2330', name: '台積電', view: dummyView, report: dummyReport, range: '1y' }),
      )

      /*
        This one is deliberately nailed down. Martingale differs in kind from the other three frameworks:
        pyramid, inverted pyramid and grid are all bounded position management, while by definition Martingale is
        unbounded (double after a loss). "One bounce and you are whole again" only holds with infinite capital,
        which no real account has —— without that premise stated, it reads like a guaranteed win.
      */
      expect(system).toContain('標的不會歸零、而且資金無限')
      expect(system).toContain('真實帳戶兩者都不成立')
      expect(system).toContain('所需投入資金呈指數成長')
      expect(system).toContain('每次提到它，都必須同時說明這個前提')
      expect(system).toContain('不得把它描述成與前三項等價的選項')
    })

    it('提到攤平時必須在「注意事項」講風險（攤平不等於降低風險）', () => {
      const { system } = renderAiPrompt(
        buildAiPayload({ ticker: '2330', name: '台積電', view: dummyView, report: dummyReport, range: '1y' }),
      )
      expect(system).toContain('攤平會放大部位，並不等於降低風險')
      expect(system).toContain('越攤平虧損越大')
    })

    it('基本面有資料時應帶單位、產業別與逐則標題', () => {
      const payload = buildAiPayload({
        ticker: '2330',
        name: '台積電',
        view: dummyView,
        report: dummyReport,
        range: '1y',
        fundamental: {
          ticker: '2330',
          asOf: '2026-07-27T09:31:00.000Z',
          dataDate: '2026-07-25',
          industry: '半導體業',
          valuation: {
            peRatio: 31.59,
            dividendYieldPercent: 0.94,
            pbRatio: 10.34,
            dataDate: '2026-07-24',
          },
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
        },
      })

      expect(payload.fundamental.hasData).toBe(true)
      // Monthly revenue is converted from new to old in the payload
      expect(payload.fundamental.revenueMonths?.[0].yearMonth).toBe('2026-06')

      const { user } = renderAiPrompt(payload)
      expect(user).toContain('產業別：半導體業')
      expect(user).toContain('本益比 31.59')
      expect(user).toContain('殖利率 0.94%')
      expect(user).toContain('單位：千元')
      expect(user).toContain('2026-06：營收 442679969 千元（月增 +6.16% / 年增 +67.87%）')
    })

    it('基本面缺料時應印替代文案，且不得出現數字欄位', () => {
      const payload = buildAiPayload({
        ticker: '5274',
        name: '上櫃股',
        view: dummyView,
        report: dummyReport,
        range: '1y',
        // Lack of information file for OTC stocks: There is a file but all three items are empty, which means there is no information.
        fundamental: {
          ticker: '5274',
          asOf: '2026-07-27T09:31:00.000Z',
          dataDate: '2026-07-25',
          industry: null,
          valuation: null,
          revenueUnit: '千元',
          revenueMonths: [],
          profitQuarters: [],
          notes: ['此代號查無上市基本面資料（可能為上櫃股票，暫不支援）'],
        },
      })

      expect(payload.fundamental.hasData).toBe(false)

      const { user } = renderAiPrompt(payload)
      expect(user).toContain('請勿臆測任何基本面數據')
      expect(user).not.toContain('本益比')
    })

    it('當 report 為 null 時，user prompt 應標示籌碼資料暫時無法取得', () => {
      const payload = buildAiPayload({
        ticker: '2330',
        name: '台積電',
        view: dummyView,
        report: null,
        range: '1y',
      })

      const { user } = renderAiPrompt(payload)
      expect(user).toContain('籌碼資料暫時無法取得')
    })
  })

  // The following four items are errors caught by Claude during the review. The test is pinned here to avoid changing them back in the future.
  describe('餵給模型時容易講錯的數字', () => {
    const payload = buildAiPayload({
      ticker: '2330',
      name: '台積電',
      view: dummyView,
      report: dummyReport,
      range: '1y',
    })

    it('changePct 是小數比例，必須換算成百分比數值才給模型', () => {
      // The changePct of technicalView is 0.0148 (= +1.48%); directly connected to % and printed out, it will be 100 times smaller
      expect(payload.technical.changePctPercent).toBe(1.48)
      expect(renderAiPrompt(payload).user).toContain('+1.48%')
    })

    it('連續天數必須附正負號語意說明，否則 -3 會被讀成「增加 -3 天」', () => {
      expect(payload.chip.streakNote).toContain('連續買超')
      expect(payload.chip.streakNote).toContain('連續賣超')
      expect(renderAiPrompt(payload).user).toContain('連續買超')
    })

    it('三大法人要給買進 / 賣出 / 買賣超三件組（含外資自營商），不只買賣超', () => {
      expect(payload.chip.institutional?.foreign.buyShares).toBe(2000000)
      expect(payload.chip.institutional?.foreign.sellShares).toBe(1000000)
      expect(payload.chip.institutional?.foreignDealer.netShares).toBe(0)
      const { user } = renderAiPrompt(payload)
      expect(user).toContain('外資自營商')
      expect(user).toContain('買進 2000000 股')
    })

    it('區間極值要標明是哪段區間', () => {
      expect(payload.periodLabel).toBe('近 1 年')
      expect(renderAiPrompt(payload).user).toContain('近 1 年區間極值')
    })

    it('浮點數要收斂到 2 位小數，不把 101.69999694824219 這種值丟給模型', () => {
      const noisy = buildAiPayload({
        ticker: '0050',
        name: '元大台灣50',
        view: {
          ...dummyView,
          latest: { ...dummyView.latest, close: 101.69999694824219, rsi14: 68.123456, volRatio: 1.23456 },
        },
        report: null,
        range: '1y',
      })
      expect(noisy.technical.close).toBe(101.7)
      expect(noisy.technical.rsi14).toBe(68.12)
      expect(noisy.technical.volRatioVs20DayAvg).toBe(1.23)
    })
  })

  describe('獲利能力與總經（0.6.5）', () => {
    const baseArgs = {
      ticker: '2330',
      name: '台積電',
      view: dummyView,
      report: dummyReport,
      range: '1y' as const,
    }
    const dummyFundamental = {
      ticker: '2330',
      asOf: '2026-07-27T09:31:00.000Z',
      dataDate: '2026-07-25',
      industry: '半導體業',
      valuation: null,
      revenueUnit: '千元' as const,
      revenueMonths: [],
      profitQuarters: [],
      notes: [],
    }

    const macro = {
      asOf: '2026-07-28T02:00:00.000Z',
      checkedAt: '2026-07-28T02:00:00.000Z',
      region: '美國',
      indicators: [
        {
          id: 'CPILFESL',
          label: '核心 CPI',
          kind: 'yoy' as const,
          unit: '%',
          note: '',
          latest: { period: '2026-06', value: 2.57 },
          previous: { period: '2026-05', value: 2.82 },
          points: [],
        },
        {
          id: 'PAYEMS',
          label: '非農就業',
          kind: 'momThousands' as const,
          unit: '千人',
          note: '',
          latest: { period: '2026-06', value: 57 },
          previous: { period: '2026-05', value: 129 },
          points: [],
        },
      ],
    }

    const withProfit = {
      ...dummyFundamental,
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

    it('獲利能力由新到舊，單位寫進 payload', () => {
      const p = buildAiPayload({ ...baseArgs, fundamental: withProfit })
      expect(p.fundamental.profitUnit).toBe('%')
      expect(p.fundamental.profitQuarters?.map((q) => q.yearQuarter)).toEqual([
        '2026-Q1',
        '2025-Q4',
      ])
      expect(p.fundamental.profitQuarters?.[0].grossMarginPercent).toBe(66.25)
    })

    it('總經只送最新與前期，且單位隨值走', () => {
      const p = buildAiPayload({ ...baseArgs, macro })
      expect(p.macro.hasData).toBe(true)
      expect(p.macro.region).toBe('美國')
      expect(p.macro.indicators).toEqual([
        { label: '核心 CPI', unit: '%', period: '2026-06', value: 2.57, previousValue: 2.82 },
        { label: '非農就業', unit: '千人', period: '2026-06', value: 57, previousValue: 129 },
      ])
    })

    it('缺總經時印替代文案，不印一串「無」', () => {
      const p = buildAiPayload({ ...baseArgs })
      expect(p.macro).toEqual({ hasData: false })
      const { user } = renderAiPrompt(p)
      expect(user).toContain('總體經濟資料暫時無法取得，請勿臆測總經數據')
    })

    it('prompt 明講總經非本檔個股數據，system 有「背景不是因果」的準則', () => {
      const p = buildAiPayload({ ...baseArgs, macro, fundamental: withProfit })
      const { system, user } = renderAiPrompt(p)
      expect(user).toContain('全市場共用，非本檔個股數據')
      expect(user).toContain('核心 CPI（2026-06）：2.57 %')
      expect(user).toContain('非農就業（2026-06）：57 千人')
      expect(user).toContain('毛利率 66.25% / 營益率 58.1%')
      expect(system).toContain('總體經濟是**背景**不是個股因果')
      expect(system).toContain('不得用總經數據推導本檔股票的漲跌')
    })

    it('新欄位不得破壞「payload 不含持股成本」那道硬性防護', () => {
      const p = buildAiPayload({ ...baseArgs, macro, fundamental: withProfit })
      const json = JSON.stringify(p)
      expect(json).not.toContain('holding')
      expect(json).not.toContain('avgCost')
      expect(json).not.toContain('unrealized')
    })
  })

})
