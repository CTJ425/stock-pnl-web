# 新功能開發計畫書：庫存均價細分與保本價（損益平衡價）顯示

本計畫書旨在為「庫存總覽」功能進行升級，讓使用者能一目了然：
1. **成交均價 (未含手續費)**：當下買入股票的原始價格。
2. **買入均價 (已含手續費)**：您實際付出的每股成本。
3. **保本賣出價 (預估平衡價)**：考慮未來賣出時的手續費與證交稅後，最低需要賣在多少價格才不會虧損。

---

## 1. 核心計算邏輯與公式設計

### A. 庫存成本維護 (P&L Engine 擴充)
目前 `computeLedger` 只維護了含手續費的 `cost`（部位成本）。為了精確計算不含手續費的成交均價，我們需要在 `Position` 結構中加入 `rawCost`（未含手續費的原始部位成本）。

* **買入時 (BUY)**：
  * `pos.cost += (price * qty) + fee_tax` (維持不變)
  * `pos.rawCost += (price * qty)` (新增)
* **賣出時 (SELL)**：
  * 依持股比例扣除：
    * `avgCost = pos.cost / pos.qty`
    * `avgRawCost = pos.rawCost / pos.qty`
    * `pos.cost -= avgCost * matchedQty`
    * `pos.rawCost -= avgRawCost * matchedQty`

### B. 三種均價的計算公式
1. **成交均價 (未含手續費)**：
   $$\text{成交均價} = \frac{\text{rawCost}}{\text{qty}}$$
2. **買入均價 (已含手續費)**：
   $$\text{買入均價} = \frac{\text{cost}}{\text{qty}}$$
3. **保本賣出價 (損益平衡價)**：
   為了賣出時實收金額 $\ge$ 買入總成本（`cost`），設定賣出單價為 $P$：
   $$\text{實收金額} = P \times Q - \text{賣出手續費} - \text{賣出證交稅} \ge \text{cost}$$
   $$\text{賣出手續費} = \lfloor P \times Q \times \text{工作區手續費率} \rfloor$$
   $$\text{賣出證交稅} = \lfloor P \times Q \times \text{證交稅率} \rfloor$$
   
   簡化後，每股的**保本賣出價**計算公式為（無條件進位至小數點後第 2 位以確保保本）：
   $$P_{\text{break-even}} = \left\lceil \frac{\text{cost}}{Q \times (1 - \text{手續費率} - \text{證交稅率})} \right\rceil_{0.01}$$
   *其中美股的證交稅率為 0，台股 ETF 證交稅率為 0.1%，台股一般股票為 0.3%。*

---

## 2. 程式碼修改範例

### 調整一：[pnlEngine.ts](file:///home/ivan/stock-pnl-web/sources/src/utils/pnlEngine.ts)
擴充 `Position` 與計算引擎，追蹤 `rawCost` 並導出 `rawAvgCost`。

```typescript
export interface Position {
  // ... 既有欄位 ...
  qty: number
  cost: number         // 含手續費
  rawCost: number      // 未含手續費 (新增)
  buyCostTotal: number
  realized: number
}

export interface Holding extends Position {
  avgCost: number      // 含手續費的均價
  rawAvgCost: number   // 未含手續費的成交均價 (新增)
}

// 在 computeLedger 初始位置加入：
// pos.rawCost = 0
// 在 BUY 交易中加入：
// pos.rawCost += tx.price * tx.qty
// 在 SELL 交易中計算與扣除：
// const avgRawCost = pos.qty > 0 ? pos.rawCost / pos.qty : 0
// pos.rawCost -= avgRawCost * matchedQty
```

### 調整二：[DashboardPage.tsx](file:///home/ivan/stock-pnl-web/sources/src/components/Dashboard/DashboardPage.tsx)
計算保本價並呈現在前端表格中。

```typescript
// 計算保本價
const taxRate = h.currency === 'TWD' ? sellTaxRate(h.ticker) : 0
const breakEvenPrice = Math.ceil((h.cost / (h.qty * (1 - feeRate - taxRate))) * 100) / 100
```

---

## 3. UI 呈現設計 (庫存總覽表格)

為了保持介面簡潔且美觀，我們將現有表格的「平均買入成本」欄位改造成雙行顯示，並新增一欄「保本賣出價」：

| 代號 | 名稱 | 現價 | 持有股數 | 平均買入成本 (均價) | 保本賣出價 | 目前市值 | 未實現損益 | 未實現報酬率 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0050 | 元大台灣50 | 105.00 | 1,000 | **NT$102.44** <br> <span style="font-size:11px;color:gray;">未含費 NT$102.40</span> | <span style="color:#22c55e;font-weight:600;">NT$102.63</span> | NT$105,000 | +NT$2,327 | +2.27% |
| 2330 | 台積電 | 1,010.00 | 100 | **NT$951.35** <br> <span style="font-size:11px;color:gray;">未含費 NT$950.00</span> | <span style="color:#22c55e;font-weight:600;">NT$955.62</span> | NT$101,000 | +NT$5,198 | +5.46% |

### 設計亮點：
1. **雙行均價顯示**：主標題加粗顯示「含手續費的實際每股成本」，副標題以灰色小字顯示「未含手續費的成交均價」，方便與券商軟體的不同欄位進行比對。
2. **新增「保本賣出價」欄位**：以綠色/顯眼字體標示出安全打平的賣出點，當現價高於此價格時即代表賣出必有獲利，極具交易參考價值。
