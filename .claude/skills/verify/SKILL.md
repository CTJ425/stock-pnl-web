---
name: verify
description: 驗證 stock-pnl-web 變更：啟動 vite dev server 後以 Playwright 驅動本機模式 UI
---

# 驗證流程（本機模式，免 Supabase）

## 啟動

```bash
cd sources && npm run dev   # http://localhost:5173，未設 Supabase env 時自動進入本機模式
```

## 以 Playwright 驅動

- 專案未安裝 playwright，但 npx 快取有：以
  `NODE_PATH=$(find ~/.npm/_npx -maxdepth 4 -name playwright -type d | head -1 | xargs dirname) node <script>.js`
  執行 `require('playwright')` 腳本；chromium 已裝於 `~/.cache/ms-playwright`。
- 免登入注入測試資料（localStorage）後 `page.reload()`：
  - `stock-pnl-web/local-store-v1`：`{ workspaces: [{id,name,created_at}], transactions: [{id,workspace_id,tx_date,market:'TPE'|'US',ticker,name,tx_type:'BUY'|'SELL',price,qty,fee_tax,created_at}] }`
  - `stock-pnl-web/current-workspace`：工作區 id，或 `__all__`（全部工作區總覽）
- 常用選擇器：工作區切換 `.ws-select select`（selectOption）、分頁 `getByRole('button', {name:'交易紀錄'})`、
  新增交易 FAB `.fab`、通知 `.notice-ok` / `.notice-warn`、表格 `.data-table`。
- 原生 confirm 對話框：`page.on('dialog', d => d.accept())`。
- 匯出 CSV：`page.waitForEvent('download')` 搭配點擊「匯出 CSV」。

## 值得驅動的流程

- 單一工作區 ↔ 總覽切換（唯讀守衛：無勾選框 / 編輯 / 刪除 / 匯入 / FAB）
- 交易勾選 → 刪除選取 → `.notice-ok` 成功通知
- CSV 匯出 → 貼回匯入 Modal 驗證解析（總覽匯出含「工作區」欄，多工作區檔會被整批拒絕）
- 現價為外部 API：無網路時顯示骨架屏 / 快取價，驗證勿依賴現價欄位

## 注意

- `pkill -f vite` 會連自己的 shell 一起殺（指令列含 "vite"）；改記下 PID 再 kill。
