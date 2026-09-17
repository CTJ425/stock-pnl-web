/**
 * Shared fixtures for the Task 165 Discord tests. Real payloads captured 2026-09-17 (Asia/Taipei),
 * trimmed to the fields the code reads.
 *
 * The webhook URL is assembled from pieces and its token is fake: this repo is public and runs
 * secret scanning, so no test file may carry a literal that looks like a live webhook.
 */
import type { IndexChartResponse } from './globalIndexClose.ts'
import type { MarginSummaryResponse } from './marketMargin.ts'
import type { MarketDay } from './twMarket.ts'
import type { MacroLine } from './discordSummary.ts'

export const FAKE_ID = '1'.repeat(18)
export const FAKE_TOKEN = 'Fake_Token-' + 'x'.repeat(57) + 'Wxyz'
export const FAKE_WEBHOOK = 'https://discord.com' + '/api/' + 'webhooks/' + FAKE_ID + '/' + FAKE_TOKEN

/** `reports/market/daily.json` → `days[]` entry for 2026-09-16 on DEV. */
export const MARKET_DAY_0916: MarketDay = {
  date: '2026-09-16',
  tradeVolumeShares: 8352607880,
  tradeValueTwd: 675969528562,
  transactions: 3400805,
  taiex: 45848.9,
  changePoints: 337.41,
  taiexOpen: 45546.56,
  taiexHigh: 46077.82,
  taiexLow: 45546.56,
  institutional: {
    foreignTwd: -17980479320,
    foreignDealerTwd: 0,
    trustTwd: 9573779824,
    dealerSelfTwd: -3625175693,
    dealerHedgeTwd: -9348763190,
    totalTwd: -21380638379,
    buy: {
      foreignTwd: 258230812992,
      foreignDealerTwd: 0,
      trustTwd: 25671219031,
      dealerSelfTwd: 7994739619,
      dealerHedgeTwd: 24525606530,
      totalTwd: 316422378172,
    },
    sell: {
      foreignTwd: 276211292312,
      foreignDealerTwd: 0,
      trustTwd: 16097439207,
      dealerSelfTwd: 11619915312,
      dealerHedgeTwd: 33874369720,
      totalTwd: 337803016551,
    },
  },
}

/** TWSE `MI_MARGN?date=20260916&selectType=MS` (notes dropped). */
export const MARGIN_MS_0916: MarginSummaryResponse = {
  stat: 'OK',
  date: '20260916',
  tables: [
    {
      title: '115年09月16日 信用交易統計',
      fields: ['項目', '買進', '賣出', '現金(券)償還', '前日餘額', '今日餘額'],
      data: [
        ['融資(交易單位)', '261,378', '198,132', '4,880', '9,190,511', '9,248,877'],
        ['融券(交易單位)', '25,065', '26,711', '2,650', '198,052', '197,048'],
        ['融資金額(仟元)', '19,791,815', '15,417,455', '448,165', '582,240,465', '586,166,660'],
      ],
    },
    {},
  ],
}

/** TWSE response for an unpublished (2026-09-17 13:22) or non-trading (2026-09-13) date. */
export const MARGIN_MS_EMPTY: MarginSummaryResponse = { stat: '很抱歉，沒有符合條件的資料' }

/** Yahoo `^N225` 1d/5d, fetched 2026-09-17 13:22 Taipei while Tokyo was still trading. */
export const N225_MIDSESSION: IndexChartResponse = {
  chart: {
    result: [
      {
        meta: {
          gmtoffset: 32400,
          currentTradingPeriod: { regular: { start: 1789603200, end: 1789626600 } },
        },
        timestamp: [1789084800, 1789344000, 1789430400, 1789516800, 1789603200],
        indicators: {
          quote: [{ close: [64011.33984375, 63492.98828125, 63484.1015625, 63923.0, 64096.69140625] }],
        },
      },
    ],
  },
}
/** The moment `N225_MIDSESSION` was fetched. */
export const N225_FETCHED_AT = 1789622537

/** Yahoo `^GSPC` 1d/5d, same moment — before the New York open. */
export const GSPC_PREOPEN: IndexChartResponse = {
  chart: {
    result: [
      {
        meta: {
          gmtoffset: -14400,
          currentTradingPeriod: { regular: { start: 1789651800, end: 1789675200 } },
        },
        timestamp: [1789047000, 1789133400, 1789392600, 1789479000, 1789565400],
        indicators: {
          quote: [{ close: [7591.7001953125, 7656.97998046875, 7619.97998046875, 7585.72998046875, 7551.81005859375] }],
        },
      },
    ],
  },
}

/** `reports/macro/us.json` → `indicators[]` on DEV, mapped to `MacroLine`. */
export const MACRO_LINES: MacroLine[] = [
  { id: 'CPILFESL', label: '核心 CPI', kind: 'yoy', unit: '%', latest: { period: '2026-08', value: 2.45 }, previous: { period: '2026-07', value: 2.47 } },
  { id: 'PPIFES', label: '核心 PPI', kind: 'yoy', unit: '%', latest: { period: '2026-08', value: 4.62 }, previous: { period: '2026-07', value: 4.26 } },
  { id: 'PCEPILFE', label: '核心 PCE', kind: 'yoy', unit: '%', latest: { period: '2026-07', value: 3.34 }, previous: { period: '2026-06', value: 3.34 } },
  {
    id: 'DFEDTARU', label: 'FOMC 目標利率',
    kind: 'rate',
    unit: '%',
    latest: { period: '2026-09-16', value: 3.75, valueLow: 3.5 },
    previous: { period: '2026-07-29', value: 3.75, valueLow: 3.5 },
  },
  { id: 'PAYEMS', label: '非農就業 NFP', kind: 'momThousands', unit: '千人', latest: { period: '2026-08', value: 162 }, previous: { period: '2026-07', value: 21 } },
  { id: 'UMCSENT', label: '消費者信心 UMCSENT', kind: 'index', unit: '指數', latest: { period: '2026-07', value: 55.2 }, previous: { period: '2026-06', value: 49.5 } },
]

/** `reports/fx/twd.json` → USD entry on DEV. */
export const USD_TWD = {
  code: 'USD',
  latest: 31.773399,
  prevClose: 31.7176,
  decimals: 3,
  date: '2026-09-16',
  /** 17:00 Taipei */
  asOf: '2026-09-16T09:00:01.000Z',
}

/** `market/daily.json` → `asOf` after the 15:05 Taipei preliminary BFI82U sync. */
export const MARKET_ASOF_0916 = '2026-09-16T07:05:04.902Z'
