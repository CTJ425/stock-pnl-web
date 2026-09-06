/**
 * Spec 146 Phase 2a — the app's first ErrorBoundary. Before this, a throw during render
 * unmounted the whole tree and left a blank page with nothing recorded anywhere.
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { logClient } from '../services/appLog'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  /**
   * `error` is typed `Error`, but React passes through whatever was thrown — `throw null` and
   * `throw 'x'` are both legal. Reading `.message` off `null` would throw a second time inside
   * the outermost boundary, with no ancestor to catch it: exactly the blank, unrecorded page
   * this component exists to prevent.
   */
  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    logClient('error', 'render', message, { stack })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="auth-wrap">
          <div className="glass auth-card error-fallback">
            <h2>頁面發生錯誤</h2>
            <p className="auth-sub">很抱歉，畫面發生非預期的錯誤，請重新載入頁面。</p>
            <button
              type="button"
              className="btn btn-primary error-fallback-btn"
              onClick={() => window.location.reload()}
            >
              重新載入頁面
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
