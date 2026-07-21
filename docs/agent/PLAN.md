# Development Plan (PLAN.md)

- Agent: Gemini
- Status: IN_PROGRESS
- Timestamp: 2026-07-21 09:32:30 Asia/Taipei

---

## 🎯 Short-term Goals (短期目標)

1. **GitHub Pages 自動化部署**
   - 設定 GitHub Actions workflow，讓 `main` / `dev` 分支 commit 自動 build 並部署至 GitHub Pages。
2. **Supabase 後端環境連結與部署**
   - 執行 SQL Schema 於 Supabase SQL Editor。
   - 部署 Edge Function `stock-price` 用於台/美股即時報價與搜尋代理。
   - 配置 Auth 重導向與 `.env.local` 密鑰。
3. **線上環境整合驗證**
   - 端到端測試註冊、登入、交易紀錄 CRUD、CSV 匯入匯出與年度損益統計。

---

## 🗺️ Long-term Goals (長期目標)

1. **使用者設定同步 (User Settings Sync)**
   - 將前端手續費折扣率與偏好接上 Supabase `user_settings` 資料表。
2. **自動型別產生**
   - 使用 Supabase CLI 自動產生 `database.types.ts`。
3. **離線/連線雙模切換優化**
   - 強化本機模式 (localStorage) 與 Supabase 雲端資料同步機制。
