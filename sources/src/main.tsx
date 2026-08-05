import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, getThemePref } from './utils/settings'

// Apply a theme before rendering for the first time to prevent users with bright colors from seeing flickering in dark colors
applyTheme(getThemePref())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
