# Task 136 — Lot-Based Unrealized P&L Calculation (Align with Brokerage App)

Target version: `0.9.25-dev.1` (or next planned release).

## Problem

When holding Taiwan stocks across multiple purchase transactions (batches/lots), the project's unrealized net profit & loss (`estimateUnrealized`) produces small integer rounding discrepancies (e.g. 10,167 TWD vs 10,170 TWD, and 1.62% vs 1.63% ROI) compared with Taiwanese brokerage mobile apps (e.g. Yuanta, Cathay, Fubon, Sinopac, Mitake).

### Root Cause
1. **Taiwan Fee & Tax Rounding**: Taiwanese securities regulations stipulate integer floor truncation (`Math.floor`) for brokerage commissions (0.1425%) and securities transaction taxes (0.3% general stock / 0.1% ETF / 0% bond ETF).
2. **Current Project Implementation (Aggregate)**:
   - Calculates estimated selling fee and tax over the **aggregate holding position** in one bulk formula:
     - $6,000 \text{ shares} \times 106.25 = 637,500$
     - $\text{Fee} = \lfloor 637,500 \times 0.001425 \rfloor = 908$
     - $\text{Tax} = \lfloor 637,500 \times 0.001 \rfloor = 637$
     - $\text{Total Deduction} = 1,545 \implies \text{Unrealized P\&L} = 637,500 - 625,788 - 1,545 = 10,167$
3. **Brokerage App Implementation (Open Tax Lots / 未沖銷庫存明細)**:
   - Brokerage accounting calculates unrealized P&L per open lot and sums the rows:
     - Lot 1 (2,000 shares): Market 212,500 $\implies$ Fee 302, Tax 212, P&L +1,487
     - Lot 2 (1,000 shares): Market 106,250 $\implies$ Fee 151, Tax 106, P&L +2,146
     - Lot 3 (1,000 shares): Market 106,250 $\implies$ Fee 151, Tax 106, P&L +2,847
     - Lot 4 (2,000 shares): Market 212,500 $\implies$ Fee 302, Tax 212, P&L +3,690
     - Total Deduction = 1,542 (3 TWD less due to per-lot floor) $\implies \text{Total P\&L} = 10,170$, $\text{ROI} = 1.63\%$.

## Design Contract

### A. Data Structure: `OpenLot` on Position and Holding
Define an open lot interface in `sources/src/utils/pnlEngine.ts`:

```ts
export interface OpenLot {
  txId: string
  date: string
  qty: number
  price: number
  fee: number
  cost: number     // price * qty + fee (proportional on partial sell)
  rawCost: number  // price * qty
}
```

Add `openLots: OpenLot[]` to `Position` and `Holding`.

### B. Ledger Computation (`computeLedger`)
During transaction chronological scan:
- **`BUY`**: Append a new `OpenLot` to `pos.openLots`.
- **`SELL`**: Apply FIFO matching across `pos.openLots`:
  - Deduct sold quantity from the oldest lots first.
  - On partial fills of a lot, reduce lot `qty`, `cost`, and `rawCost` proportionally:
    `ratio = matchedQty / lot.qty; lot.cost -= lot.cost * ratio; lot.rawCost -= lot.rawCost * ratio; lot.qty -= matchedQty`.
  - Remove fully matched lots.

### C. Unrealized P&L Estimation (`estimateUnrealized`)
Update `estimateUnrealized(holding: Holding, price: number, feeRate: number, minFee?: number): number`:

1. **When `holding.openLots` has items (Taiwan stocks)**:
   - Iterate each lot `l` in `holding.openLots`:
     - `lotMktVal = price * l.qty`
     - `lotFee = floorSafe(lotMktVal * feeRate)`
     - Apply `minFee` if `minFee !== undefined && feeRate > 0 && lotFee < minFee`
     - `lotTax = floorSafe(lotMktVal * sellTaxRate(holding.ticker))`
     - `lotPnl = lotMktVal - l.cost - lotFee - lotTax`
   - Return `Math.round(sum(lotPnl))`.
2. **US Stocks / Fallback**:
   - For US stocks (or when `openLots` is empty), retain the standard formula `mktVal - holding.cost`.

### D. Downstream Compatibility
- `HoldingRow` in `holdingRows.ts` uses `estimateUnrealized(h, price, feeRate, minFee)` without signature breakage.
- Dashboard cards and KPI sums automatically reflect the exact lot-based sum.
- `rawUnrealized` remains `mktVal - h.rawCost` (pure price spread before fees).

## Files to Modify

- `sources/src/utils/pnlEngine.ts` (add `OpenLot`, FIFO open lot tracking, per-lot `estimateUnrealized`)
- `sources/src/utils/pnlEngine.test.ts` (test cases for FIFO lot maintenance, multi-lot rounding alignment)
- `sources/src/utils/holdingRows.ts` & `sources/src/utils/holdingRows.test.ts` (verify row mapping and ROI)

## Test Charter

| Case | Expected Outcome | Layer / File |
| :--- | :--- | :--- |
| Single-lot buy | Result is identical to legacy aggregate formula | `pnlEngine.test.ts` |
| Multi-lot buy (0050 reference: 2k, 1k, 1k, 2k @ 106.25) | Unrealized P&L === 10,170, ROI === 1.63% | `pnlEngine.test.ts` |
| Partial sell | Oldest lot reduced via FIFO; remaining lots maintain exact cost | `pnlEngine.test.ts` |
| Full liquidation and re-buy | Old lots cleared, new lots tracked cleanly | `pnlEngine.test.ts` |
| US stock holdings | No sell fee/tax deduction; simple `mktVal - cost` | `pnlEngine.test.ts` |

## Non-Goals

- Do not change realized gain/loss accounting formula for past tax year summaries (moving average cost basis remains intact).
- Do not alter `breakEvenPrice` core solver (breakeven price reflects entire holding recovery).
