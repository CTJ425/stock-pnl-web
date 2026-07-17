/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' 使打包後資源使用相對路徑，可部署於 GitHub Pages 子路徑
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    setupFiles: ['./src/test/setup.ts'],
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
