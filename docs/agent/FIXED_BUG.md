# Fixed Bugs History (FIXED_BUG.md)

- Agent: Gemini
- Status: ACTIVE
- Timestamp: 2026-07-21 09:32:30 Asia/Taipei

---

## 🐛 Historical Bug Fixes

### Bug ID: BUG-001 - 庫存總覽與券商 APP 均價與損益率口徑不一致
- **Date**: 2026-07-17
- **Root Cause**:
  1. **均價落差**: 手續費登錄為 80 元（實際券商為 40 元），導致計算買入均價由 102.44 升至 102.48。
  2. **損益率落差**: 原系統庫存總覽混入歷史已結清週期之損益與成本（分母含已結清部位成本），導致計算總報酬率與證券 APP 的未實現報酬率口徑不同。
- **Fix**:
  1. 交易紀錄更新手續費登錄值。
  2. 修改 Dashboard 元件與損益計算邏輯：移除「已實現損益」「累計總損益」欄位，總報酬率調整為僅採計當前部位之「未實現報酬率」（未實現損益 / 當前部位總成本）。
- **Changed Files**: `sources/src/components/Dashboard/`, `sources/src/utils/pnlEngine.ts`
- **Verification**: 通過單元測試與手動比對證券 APP 口徑。
