/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' 使打包後資源使用相對路徑，可部署於 GitHub Pages 子路徑
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    setupFiles: ['./src/test/setup.ts'],
    // vitest 預設 5 秒，對「render 整個 App + userEvent 逐字輸入」那幾支整合測試
    // （App.smoke / TransactionsPage I1–I7）是邊界值：機器一忙就整批逾時，
    // 而且是**與程式碼無關的偽陽性** —— 2026-07-28 實測把所有異動 stash 掉、
    // 在乾淨的 main 上跑，同樣 7 支全部逾時。
    // 閘門一旦會無故變紅就沒人信它了，故拉高到 20 秒。
    testTimeout: 20_000,
    // 煙霧測試以「本機模式」為前提；清空 Supabase 環境變數，
    // 避免開發者的 .env.local 讓測試跑進 Supabase 模式
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
  server: {
    // TWSE / TPEx OpenAPI 未開放 CORS，開發模式經 dev server 代理取得台股清單與現價；
    // 正式環境（GitHub Pages）由 Supabase Edge Function 代理（見 src/services/priceProxy.ts）
    proxy: {
      '/api/twse': {
        target: 'https://openapi.twse.com.tw',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/twse/, ''),
      },
      '/api/tpex': {
        target: 'https://www.tpex.org.tw',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/tpex/, ''),
      },
    },
  },
})
