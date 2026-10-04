import { describe, expect, it } from 'vitest'
import { layoutSectors, squarify, type Placed } from './treemapLayout'

const BOX = { x: 0, y: 0, w: 200, h: 100 }
const area = (p: Placed) => p.w * p.h
const overlap = (a: Placed, b: Placed) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6

describe('squarify', () => {
  const items = [
    { id: 'a', value: 6 },
    { id: 'b', value: 6 },
    { id: 'c', value: 4 },
    { id: 'd', value: 3 },
    { id: 'e', value: 2 },
    { id: 'f', value: 2 },
    { id: 'g', value: 1 },
  ]

  it('gives every item an area proportional to its value and fills the box', () => {
    const out = squarify(items, BOX)
    const total = items.reduce((s, i) => s + i.value, 0)
    expect(out).toHaveLength(items.length)
    for (const p of out) {
      const v = items.find((i) => i.id === p.id)!.value
      expect(area(p) / (BOX.w * BOX.h)).toBeCloseTo(v / total, 9)
    }
    expect(out.reduce((s, p) => s + area(p), 0)).toBeCloseTo(BOX.w * BOX.h, 6)
  })

  it('keeps every tile inside the box and none on top of another', () => {
    const out = squarify(items, BOX)
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9)
      expect(p.y).toBeGreaterThanOrEqual(-1e-9)
      expect(p.x + p.w).toBeLessThanOrEqual(BOX.w + 1e-9)
      expect(p.y + p.h).toBeLessThanOrEqual(BOX.h + 1e-9)
    }
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlap(out[i], out[j])).toBe(false)
  })

  it('is deterministic and independent of the input order', () => {
    const a = squarify(items, BOX)
    const b = squarify([...items].reverse(), BOX)
    expect(b).toEqual(a)
  })

  it('breaks equal values by id', () => {
    const out = squarify([{ id: 'z', value: 1 }, { id: 'a', value: 1 }], BOX)
    expect(out.map((p) => p.id)).toEqual(['a', 'z'])
  })

  it('puts the biggest value first, in the top-left corner', () => {
    const out = squarify(items, BOX)
    expect(out[0]).toMatchObject({ id: 'a', x: 0, y: 0 })
  })

  it('keeps tiles reasonably square (no sliver worse than 1:6 for this input)', () => {
    for (const p of squarify(items, BOX)) expect(Math.max(p.w / p.h, p.h / p.w)).toBeLessThan(6)
  })

  it('ignores zero, negative and non-finite values, and an empty box', () => {
    expect(squarify([{ id: 'a', value: 0 }, { id: 'b', value: -1 }, { id: 'c', value: NaN }], BOX)).toEqual([])
    expect(squarify([{ id: 'a', value: 1 }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([])
    expect(squarify([{ id: 'a', value: 5 }, { id: 'b', value: 0 }], BOX)).toHaveLength(1)
  })

  it('one item fills the whole box', () => {
    expect(squarify([{ id: 'a', value: 3 }], BOX)).toEqual([{ id: 'a', ...BOX }])
  })
})

describe('layoutSectors', () => {
  const sectors = [
    { id: '28', value: 40, children: [] },
    { id: '24', value: 50, children: [{ id: '24:a', value: 30 }, { id: '24:b', value: 20 }] },
    { id: '17', value: 10, children: [] },
  ]

  it('returns percentages of the container, covering all of it', () => {
    const tiles = layoutSectors(sectors, 1.5, 5)
    expect(tiles.map((t) => t.id).sort()).toEqual(['17', '24', '28'])
    const covered = tiles.reduce((s, t) => s + (t.w / 100) * (t.h / 100), 0)
    expect(covered).toBeCloseTo(1, 9)
    for (const t of tiles) {
      expect(t.x + t.w).toBeLessThanOrEqual(100 + 1e-9)
      expect(t.y + t.h).toBeLessThanOrEqual(100 + 1e-9)
    }
  })

  it('sizes sectors by value regardless of the container shape', () => {
    for (const aspect of [0.8, 1.5]) {
      const tiles = layoutSectors(sectors, aspect, 5)
      const share = (id: string) => {
        const t = tiles.find((x) => x.id === id)!
        return (t.w * t.h) / 10000
      }
      expect(share('24')).toBeCloseTo(0.5, 9)
      expect(share('28')).toBeCloseTo(0.4, 9)
      expect(share('17')).toBeCloseTo(0.1, 9)
    }
  })

  it('lays children out inside the parent body, proportional to value, and only for a parent', () => {
    const tiles = layoutSectors(sectors, 1.5, 5)
    const parent = tiles.find((t) => t.id === '24')!
    expect(parent.children.map((c) => c.id).sort()).toEqual(['24:a', '24:b'])
    const inner = parent.children.reduce((s, c) => s + (c.w / 100) * (c.h / 100), 0)
    expect(inner).toBeCloseTo(1, 9)
    const a = parent.children.find((c) => c.id === '24:a')!
    expect((a.w * a.h) / 10000).toBeCloseTo(0.6, 9)
    expect(tiles.find((t) => t.id === '28')!.children).toEqual([])
  })

  it('leaves no children when the header would take the whole tile', () => {
    const tiles = layoutSectors(sectors, 1.5, 500)
    expect(tiles.find((t) => t.id === '24')!.children).toEqual([])
  })
})
