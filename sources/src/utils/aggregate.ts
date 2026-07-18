/**
 * 跨工作區彙總（「全部工作區」總覽模式）：
 *
 * 每個工作區（券商）各自以 computeLedger 計算後再合併結果——
 * 不可把交易混在一起算：同一檔股票在不同券商的移動平均成本
 * 會互相污染，已實現損益就對不上各家 APP。
 *
 * - holdings：各工作區持股並列（同代號跨券商為多列），附工作區資訊
 *   供 Dashboard 以「該工作區的費率設定」估算未實現損益
 * - yearly / summary：已實現數字為歷史事實（費率已含在逐筆 fee_tax），
 *   跨工作區依年度／代號加總即可
 */
import type { Transaction, Workspace } from '../types/models'
import type { Holding, Ledger, YearSummary } from './pnlEngine'
import { computeLedger } from './pnlEngine'

/** 附上所屬工作區的持股（key 仍為 market:ticker，現價查詢共用） */
export interface WorkspaceHolding extends Holding {
  workspaceId: string
  workspaceName: string
}

export interface AggregatedView {
  /** 合併後的 ledger：yearly / years / summary / warnings 正確；holdings 請改用下方欄位 */
  ledger: Ledger
  /** 各工作區持股並列（依工作區順序，工作區內維持原排序） */
  holdings: WorkspaceHolding[]
}

export function aggregateWorkspaces(
  workspaces: Workspace[],
  transactions: Transaction[],
): AggregatedView {
  const byWorkspace = new Map<string, Transaction[]>()
  for (const tx of transactions) {
    const list = byWorkspace.get(tx.workspace_id)
    if (list) list.push(tx)
    else byWorkspace.set(tx.workspace_id, [tx])
  }

  const merged: Ledger = {
    positions: {},
    order: [],
    holdings: [],
    yearly: {},
    years: [],
    summary: { realizedTw: 0, realizedUs: 0, fees: 0, count: 0 },
    warnings: [],
  }
  const holdings: WorkspaceHolding[] = []

  for (const ws of workspaces) {
    const txs = byWorkspace.get(ws.id)
    if (!txs || txs.length === 0) continue
    const ledger = computeLedger(txs)

    for (const h of ledger.holdings) {
      holdings.push({ ...h, workspaceId: ws.id, workspaceName: ws.name })
    }
    for (const w of ledger.warnings) {
      merged.warnings.push(`[${ws.name}] ${w}`)
    }

    merged.summary.realizedTw += ledger.summary.realizedTw
    merged.summary.realizedUs += ledger.summary.realizedUs
    merged.summary.fees += ledger.summary.fees
    merged.summary.count += ledger.summary.count

    for (const year of ledger.years) {
      const src = ledger.yearly[year]
      let dst = merged.yearly[year]
      if (!dst) {
        dst = {
          year,
          realizedTw: 0,
          realizedUs: 0,
          buyAmt: 0,
          sellAmt: 0,
          fees: 0,
          count: 0,
          tickers: {},
        } satisfies YearSummary
        merged.yearly[year] = dst
      }
      dst.realizedTw += src.realizedTw
      dst.realizedUs += src.realizedUs
      dst.buyAmt += src.buyAmt
      dst.sellAmt += src.sellAmt
      dst.fees += src.fees
      dst.count += src.count

      for (const [key, t] of Object.entries(src.tickers)) {
        const existing = dst.tickers[key]
        if (!existing) {
          dst.tickers[key] = { ...t }
        } else {
          existing.buyAmt += t.buyAmt
          existing.sellAmt += t.sellAmt
          existing.realized += t.realized
          existing.fees += t.fees
          existing.count += t.count
          if (t.name) existing.name = t.name
        }
      }
    }
  }

  merged.years = Object.keys(merged.yearly)
    .map(Number)
    .sort((a, b) => a - b)

  return { ledger: merged, holdings }
}
