/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' enables the packaged resources to use relative paths and can be deployed in GitHub Pages sub-paths
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    setupFiles: ['./src/test/setup.ts'],
    // vitest defaults to 5 seconds to test the integration of "render the entire App + userEvent input verbatim"
    // (App.smoke/TransactionsPage I1–I7) is the boundary value: the entire batch will time out as soon as the machine is busy.
    // And it is a **false positive that has nothing to do with the program code** —— 2026-07-28 Actual test stash out all changes,
    // When running on a clean main, all 7 of them timed out.
    // Once the gate turns red for no reason, no one will believe it, so it is raised to 20 seconds.
    testTimeout: 20_000,
    // The smoke test is based on "local mode"; clear the Supabase environment variables.
    // Avoid developers' .env.local and let tests run in Supabase mode
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
  server: {
    allowedHosts: true,
    // TWSE / TPEx OpenAPI does not open CORS, and the development mode obtains the Taiwan stock list and current price through the dev server agent;
    // The official environment (GitHub Pages) is proxied by Supabase Edge Function (see src/services/priceProxy.ts)
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
