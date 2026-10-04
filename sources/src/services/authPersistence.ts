/**
 * Where the Supabase session lives, and for how long ("保持登入 7 天").
 *
 * The meta key (always in localStorage) records the choice made at sign-in:
 * - a timestamp   → remembered: session in localStorage, treated as signed out once the time passes
 * - 'session'     → not remembered: session in sessionStorage, gone when the browser closes
 * - absent        → no choice yet (an existing session from before this feature, or a session that
 *                   arrived through an email link): remembered, and the 7 days start on first use
 *
 * The 7-day cap is enforced in the browser only. It is a convenience limit, not a security
 * boundary: the refresh token itself stays valid on the server (a server-side timebox is a
 * Supabase Pro setting).
 */

export const REMEMBER_DAYS = 7
export const PERSIST_META_KEY = 'stock-pnl-web/auth-persist'

const REMEMBER_MS = REMEMBER_DAYS * 24 * 60 * 60 * 1000
const SESSION_MODE = 'session'

type Meta = 'session' | number | null

/** Storage can throw (private mode, blocked site data); every access goes through this. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function readMeta(): Meta {
  const raw = safe(() => localStorage.getItem(PERSIST_META_KEY), null)
  if (raw === null) return null
  if (raw === SESSION_MODE) return 'session'
  const until = Number(raw)
  return Number.isFinite(until) ? until : null
}

function writeMeta(value: string | null) {
  safe(() => {
    if (value === null) localStorage.removeItem(PERSIST_META_KEY)
    else localStorage.setItem(PERSIST_META_KEY, value)
  }, undefined)
}

function purgeLocalAuthKeys() {
  safe(() => {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && /^sb-.+-auth-token/.test(key)) doomed.push(key)
    }
    doomed.forEach((key) => localStorage.removeItem(key))
  }, undefined)
}

/** Call right before sign-in: decides which storage the new session is written to. */
export function setRemember(remember: boolean, now: number = Date.now()) {
  writeMeta(remember ? String(now + REMEMBER_MS) : SESSION_MODE)
}

/** Forget the choice (sign-out), so the next session starts from the default again. */
export function clearPersistence() {
  writeMeta(null)
}

/** True once a remembered login has outlived its 7 days. */
export function isRememberExpired(now: number = Date.now()): boolean {
  const meta = readMeta()
  return typeof meta === 'number' && meta <= now
}

/** Drop an expired remembered login completely (the session and its refresh token). */
export function expireRemembered() {
  purgeLocalAuthKeys()
  clearPersistence()
}

/** `auth.storage` for supabase-js: picks localStorage or sessionStorage per the stored choice. */
export const authStorage = {
  getItem(key: string): string | null {
    const meta = readMeta()
    if (meta === 'session') return safe(() => sessionStorage.getItem(key), null)
    if (typeof meta === 'number' && meta <= Date.now()) {
      expireRemembered()
      return null
    }
    const value = safe(() => localStorage.getItem(key), null)
    // A session that predates this feature: start its 7 days now.
    if (meta === null && value !== null) writeMeta(String(Date.now() + REMEMBER_MS))
    return value
  },

  setItem(key: string, value: string) {
    const meta = readMeta()
    if (meta === 'session') {
      safe(() => sessionStorage.setItem(key, value), undefined)
      return
    }
    if (typeof meta === 'number' && meta <= Date.now()) {
      // A refresh landing after the cap must not revive the login.
      expireRemembered()
      return
    }
    if (meta === null) writeMeta(String(Date.now() + REMEMBER_MS))
    safe(() => localStorage.setItem(key, value), undefined)
  },

  removeItem(key: string) {
    safe(() => localStorage.removeItem(key), undefined)
    safe(() => sessionStorage.removeItem(key), undefined)
  },
}
