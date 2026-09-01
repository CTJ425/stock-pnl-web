import { describe, expect, it } from 'vitest'
import { parseTransactionsCsv } from './csv'
import { computeLedger, sellTaxRate, floorSafe } from './pnlEngine'
import { proposeFeeCorrections } from './fees'
import type { Transaction } from '../types/models'

// ?raw keeps this inside Vite's transform, so the app tsconfig needs no node types
import ronlinCsv from '../../../docs/交易紀錄-Ronlin股票紀錄-2026-08-24.csv?raw'
import esunCsv from '../../../docs/交易紀錄-玉山證卷-2026-08-25.csv?raw'

function load(text: string, ws: string): Transaction[] {
  const r = parseTransactionsCsv(text)
  expect(r.errors).toEqual([])
  return r.rows.map((row, i) => ({
    ...row, id: `${ws}-${i}`, workspace_id: ws,
    created_at: `2024-01-01T00:00:${String(i).padStart(2, '0')}Z`,
  }))
}

describe('真實匯出檔端到端', () => {
  const ronlin = load(ronlinCsv, 'ronlin')
  const esun = load(esunCsv, 'esun')

  it('兩檔都完整匯入', () => {
    expect(ronlin).toHaveLength(53)
    expect(esun).toHaveLength(53)
  })

  it('費用拆分：每一筆賣出的稅都不超過該筆總額，手續費不為負', () => {
    for (const [name, txs] of [['ronlin', ronlin], ['esun', esun]] as const) {
      const l = computeLedger(txs)
      expect(l.summary.feesTax, name).toBeGreaterThan(0)
      expect(l.summary.feesBrokerage, name).toBeGreaterThanOrEqual(0)
      expect(l.summary.feesTax + l.summary.feesBrokerage, name).toBe(l.summary.fees)
    }
  })

  it('當沖賣出的手續費不再被歸零', () => {
    // 舊版 Math.min 會把 2344 與 2303 這兩筆當沖的手續費壓成 0
    const dayTrades = ronlin.filter(
      (t) => t.tx_type === 'SELL' && t.fee_tax < floorSafe(t.price * t.qty * sellTaxRate(t.ticker)),
    )
    expect(dayTrades.map((t) => `${t.tx_date} ${t.ticker}`)).toEqual([
      '2026-08-18 2344',
      '2026-08-24 2303',
    ])
    for (const t of dayTrades) {
      const half = floorSafe((t.price * t.qty * sellTaxRate(t.ticker)) / 2)
      expect(t.fee_tax - half).toBeGreaterThan(0)
    }
  })

  it('批次重算：兩筆當沖不被提案，只留下真正對不上費率的紀錄', () => {
    const ronlinOut = proposeFeeCorrections(ronlin, { feeRate: 0.0004275, minFeeWhole: 20, minFeeOdd: 1 })
      .map((p) => `${p.tx.tx_date} ${p.tx.ticker} ${p.tx.fee_tax}->${p.newFee}`)
    // 2891 那筆多收 3,300 元、00685L 那筆用原價而非 3 折 —— 兩者都真的與費率不符，該提案
    expect(ronlinOut).toEqual(['2026-06-05 2891 3932->722', '2026-06-23 00685L 459->137'])
    // 當沖的 2344 與 2303 不得出現：舊版會提議改成 645 / 422，多課 283 / 185 元的稅
    expect(ronlinOut.some((s) => s.includes('2344') || s.includes('2303'))).toBe(false)
    // 玉山全是一般稅率且金額都對，不該提出任何更動
    expect(proposeFeeCorrections(esun, { feeRate: 0.001425, minFeeWhole: 20, minFeeOdd: 1 })
      .map((p) => `${p.tx.tx_date} ${p.tx.ticker} ${p.tx.fee_tax}->${p.newFee}`)).toEqual([])
  })

  it('未沖銷批次數量總和等於持股數', () => {
    for (const [name, txs] of [['ronlin', ronlin], ['esun', esun]] as const) {
      for (const h of computeLedger(txs).holdings) {
        const lotQty = h.openLots.reduce((s, l) => s + l.qty, 0)
        expect(lotQty, `${name} ${h.ticker}`).toBe(h.qty)
        expect(h.openLots.every((l) => l.qty > 0), `${name} ${h.ticker}`).toBe(true)
      }
    }
  })
})
