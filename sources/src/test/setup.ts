/**
 * Vitest shared setup:
 * happy-dom will delegate localStorage to Node's experimental localStorage in the Node environment
 * (requires --localstorage-file to be available); in order for the test not to rely on the Node flag,
 * Change to a memory implementation when localStorage is missing.
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
