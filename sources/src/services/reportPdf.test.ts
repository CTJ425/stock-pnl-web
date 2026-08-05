import { describe, it, expect } from 'vitest'
import { pdfScaleFor } from './reportPdf'

/**
 * The upper limit of the canvas area of ​​iOS Safari (approximately 16.7M px²) fails silently: if it is exceeded, toDataURL will return blank.
 * Users only see "PDF generation failed." 0.6.8 I stepped on it after merging the four paragraphs of individual stock analysis into one page.
 * Therefore, it was changed to automatically reduce the magnification based on the content area. This set of tests nails that line.
 */
describe('pdfScaleFor', () => {
  it('內容短時維持 scale 2（既有畫質不變）', () => {
    // The chip paging before 0.6.7 was about 1140×1400
    expect(pdfScaleFor(1140, 1400)).toBe(2)
  })

  it('0.6.8 合併後的實測尺寸會降倍率，避免撐爆 canvas', () => {
    // Actual measurement: 1140×3885: 17.7M px² at scale 2, exceeding the upper limit
    const s = pdfScaleFor(1140, 3885)
    expect(s).toBeLessThan(2)
    // The pushback of the root number must fall exactly on the upper limit, leaving a little floating point margin (the actual measured difference is 1.9e-9)
    expect(1140 * s * (3885 * s)).toBeLessThanOrEqual(16_000_000 * 1.000001)
  })

  it('無論多長都不低於 1（再低文字就讀不出來了）', () => {
    expect(pdfScaleFor(1140, 100_000)).toBe(1)
  })

  it('產出的 canvas 面積一律不超過上限（除非已經壓到下限）', () => {
    for (const h of [800, 1400, 2600, 3885, 5000, 8000]) {
      const s = pdfScaleFor(1140, h)
      if (s > 1) expect(1140 * s * (h * s)).toBeLessThanOrEqual(16_000_000 * 1.000001)
    }
  })

  it('尺寸為 0 時不回 NaN 或 Infinity', () => {
    expect(Number.isFinite(pdfScaleFor(0, 0))).toBe(true)
    expect(pdfScaleFor(0, 0)).toBe(2)
  })
})
