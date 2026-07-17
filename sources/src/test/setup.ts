/**
 * Vitest 共用 setup：
 * happy-dom 在 Node 環境會把 localStorage 委派給 Node 的實驗性 localStorage
 * （需要 --localstorage-file 才可用）；為了讓測試不依賴 Node 旗標，
 * 缺少 localStorage 時改掛一個記憶體實作。
 */

class MemoryStorage implements Storage {
  private map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
}

if (typeof window !== 'undefined' && !window.localStorage) {
  const storage = new MemoryStorage()
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
}
