# New function development plan: average inventory price breakdown and breakeven price (profit and loss even price) display

This plan aims to upgrade the "Inventory Overview" function so that users can see at a glance:
1. **Average transaction price (excluding handling fees)**: The original price at which the stock was purchased at the moment.
2. **Average purchase price (including handling fees)**: The actual cost per share you pay.
3. **Break-even selling price (estimated equilibrium price)**: After taking into account the handling fees and securities taxes when selling in the future, what is the minimum price that needs to be sold at to avoid loss.

---

## 1. Core calculation logic and formula design

### A. Inventory Cost Maintenance (P&L Engine Extension)
Currently `computeLedger` only maintains `cost` (position cost) including handling fees. In order to accurately calculate the average transaction price without handling fees, we need to add `rawCost` (original position cost without handling fees) to the `Position` structure.

* **When Buying (BUY)**:
  * `pos.cost += (price * qty) + fee_tax` (remain unchanged)
  * `pos.rawCost += (price * qty)` (new)
* **When selling (SELL)**:
  * Deduction based on shareholding ratio:
    * `avgCost = pos.cost / pos.qty`
    * `avgRawCost = pos.rawCost / pos.qty`
    * `pos.cost -= avgCost * matchedQty`
    * `pos.rawCost -= avgRawCost * matchedQty`

### B. Calculation formulas for three average prices
1. **Average transaction price (excluding handling fees)**:
   $$\text{Average Transaction Price} = \frac{\text{rawCost}}{\text{qty}}$$
2. **Average buying price (including handling fee)**:
   $$\text{Average purchase price} = \frac{\text{cost}}{\text{qty}}$$
3. **Break-even selling price (breakeven price)**:
   In order to get the actual amount received when selling $\ge$ and the total purchase cost (`cost`), set the selling unit price to $P$:
   $$\text{Amount actually received} = P \times Q - \text{Selling fee} - \text{Tax on selling certificate} \ge \text{cost}$$
   $$\text{Selling fee} = \lfloor P \times Q \times \text{Workspace fee} \rfloor$$
   $$\text{Selling certificate tax} = \lfloor P \times Q \times \text{Security tax rate} \rfloor$$
   
   After simplification, the calculation formula for the **breakeven selling price** per share is (unconditionally rounded to the 2nd decimal place to ensure capital preservation):
   $$P_{\text{break-even}} = \left\lceil \frac{\text{cost}}{Q \times (1 - \text{handling rate} - \text{securities tax rate})} \right\rceil_{0.01}$$
   *Among them, the securities tax rate for U.S. stocks is 0, the securities tax rate for Taiwan stocks ETF is 0.1%, and the securities tax rate for general Taiwan stocks is 0.3%. *

---

## 2. Code modification example

### Adjustment 1:[pnlEngine.ts](file:///home/ivan/stock-pnl-web/sources/src/utils/pnlEngine.ts)
Extend `Position` with calculation engine, track `rawCost` and export `rawAvgCost`.

```typescript
export interface Position {
  // ... existing fields ...
  qty: number
  cost: number // Including handling fee
  rawCost: number // Not including handling fee (new)
  buyCostTotal: number
  realized: number
}

export interface Holding extends Position {
  avgCost: number // Average price including handling fee
  rawAvgCost: number // Average transaction price without handling fees (new)
}

// Add at the initial position of computeLedger:
// pos.rawCost = 0
// Add to BUY transaction:
// pos.rawCost += tx.price * tx.qty
// Calculate and deduct in SELL transactions:
// const avgRawCost = pos.qty > 0 ? pos.rawCost / pos.qty : 0
// pos.rawCost -= avgRawCost * matchedQty
```

### Adjustment 2:[DashboardPage.tsx](file:///home/ivan/stock-pnl-web/sources/src/components/Dashboard/DashboardPage.tsx)
Calculate the breakeven price and present it in the front-end table.

```typescript
// Calculate the breakeven price
const taxRate = h.currency === 'TWD' ? sellTaxRate(h.ticker) : 0
const breakEvenPrice = Math.ceil((h.cost / (h.qty * (1 - feeRate - taxRate))) * 100) / 100
```

---

## 3. UI presentation design (inventory overview table)

In order to keep the interface simple and beautiful, we changed the "Average Buying Cost" field of the existing table into a two-row display, and added a new column of "Break-Proof Selling Price":

| Code | Name | Current price | Number of shares held | Average purchase cost (average price) | Breakeven selling price | Current market value | Unrealized gains and losses | Unrealized rate of return |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0050 | Yuanta Taiwan 50 | 105.00 | 1,000 | **NT$102.44** <br> <span style="font-size:11px;color:gray;">NT$102.40</span> | <span style="color:#22c55e;font-weight:600;">NT$102.63</span> | NT$105,000 | +NT$2,327 | +2.27% |
| 2330 | TSMC | 1,010.00 | 100 | **NT$951.35** <br> <span style="font-size:11px;color:gray;">NT$950.00</span> | <span style="color:#22c55e;font-weight:600;">NT$955.62</span> | NT$101,000 | +NT$5,198 | +5.46% |

### Design highlights:
1. **Double-line average price display**: The main title displays "Actual cost per share including handling fees" in bold, and the subtitle displays "Average transaction price without handling fees" in small gray letters, making it easier to compare with different fields in the brokerage software.
2. **Added "Break-Profit Selling Price" field**: Mark the safe selling point in green/prominent fonts. When the current price is higher than this price, it means that selling will definitely make a profit, which is of great trading reference value.
