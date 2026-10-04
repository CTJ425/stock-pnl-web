// @vitest-environment jsdom
/** Where the session is stored and when a remembered login stops counting ("保持登入 7 天"). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PERSIST_META_KEY,
  REMEMBER_DAYS,
  authStorage,
  clearPersistence,
  expireRemembered,
  isRememberExpired,
  setRemember,
} from './authPersistence'

const KEY = 'sb-abc-auth-token'
const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0)

describe('authPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('P1: a remembered login is written to localStorage and readable for 7 days', () => {
    setRemember(true)
    authStorage.setItem(KEY, 'S')
    expect(localStorage.getItem(KEY)).toBe('S')
    expect(sessionStorage.getItem(KEY)).toBeNull()

    vi.setSystemTime(T0 + REMEMBER_DAYS * DAY - 1000)
    expect(authStorage.getItem(KEY)).toBe('S')
    expect(isRememberExpired()).toBe(false)
  })

  it('P2: after 7 days the session reads as gone and its tokens are purged', () => {
    setRemember(true)
    authStorage.setItem(KEY, 'S')
    authStorage.setItem(`${KEY}-user`, 'U')

    vi.setSystemTime(T0 + REMEMBER_DAYS * DAY + 1000)
    expect(isRememberExpired()).toBe(true)
    expect(authStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem(`${KEY}-user`)).toBeNull()
    expect(localStorage.getItem(PERSIST_META_KEY)).toBeNull()
  })

  it('P3: a token refresh that lands after the cap does not revive the login', () => {
    setRemember(true)
    authStorage.setItem(KEY, 'S')

    vi.setSystemTime(T0 + REMEMBER_DAYS * DAY + 1000)
    authStorage.setItem(KEY, 'REFRESHED')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(authStorage.getItem(KEY)).toBeNull()
  })

  it('P4: a login that is not remembered lives in sessionStorage only, with no expiry', () => {
    setRemember(false)
    authStorage.setItem(KEY, 'S')
    expect(sessionStorage.getItem(KEY)).toBe('S')
    expect(localStorage.getItem(KEY)).toBeNull()

    vi.setSystemTime(T0 + 30 * DAY)
    expect(authStorage.getItem(KEY)).toBe('S')
    expect(isRememberExpired()).toBe(false)
  })

  it('P5: a session from before this feature is kept, and its 7 days start on first read', () => {
    localStorage.setItem(KEY, 'OLD')
    expect(localStorage.getItem(PERSIST_META_KEY)).toBeNull()

    expect(authStorage.getItem(KEY)).toBe('OLD')
    expect(localStorage.getItem(PERSIST_META_KEY)).toBe(String(T0 + REMEMBER_DAYS * DAY))
  })

  it('P6: a session that arrives with no choice made (email link) is remembered', () => {
    authStorage.setItem(KEY, 'S')
    expect(localStorage.getItem(KEY)).toBe('S')
    expect(localStorage.getItem(PERSIST_META_KEY)).toBe(String(T0 + REMEMBER_DAYS * DAY))
  })

  it('P7: removeItem clears both storages, and clearPersistence resets the choice', () => {
    localStorage.setItem(KEY, 'A')
    sessionStorage.setItem(KEY, 'B')
    authStorage.removeItem(KEY)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()

    setRemember(false)
    clearPersistence()
    expect(localStorage.getItem(PERSIST_META_KEY)).toBeNull()
  })

  it('P8: expireRemembered leaves unrelated localStorage keys alone', () => {
    localStorage.setItem(KEY, 'S')
    localStorage.setItem('stock-pnl-web/theme', 'dark')
    expireRemembered()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem('stock-pnl-web/theme')).toBe('dark')
  })

  it('P9: blocked storage never throws', () => {
    const boom = () => {
      throw new Error('blocked')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom)
    expect(() => {
      setRemember(true)
      authStorage.setItem(KEY, 'S')
      authStorage.getItem(KEY)
      authStorage.removeItem(KEY)
      isRememberExpired()
    }).not.toThrow()
    vi.restoreAllMocks()
  })
})
