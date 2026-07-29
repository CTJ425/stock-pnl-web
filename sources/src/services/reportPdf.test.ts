import { describe, it, expect } from 'vitest'
import { pdfScaleFor } from './reportPdf'

/**
 * iOS Safari 的 canvas 面積上限（約 16.7M px²）是靜默失敗的：超過就 toDataURL 回空白，
 * 使用者只看到「PDF 產生失敗」。0.6.8 把個股分析四段併成一頁後就踩到了，
 * 故改成依內容面積自動降倍率。這組測試釘住那條線。
 */
describe('pdfScaleFor', () => {
  it('內容短時維持 scale 2（既有畫質不變）', () => {
    // 0.6.7 之前的籌碼分頁約 1140×1400
    expect(pdfScaleFor(1140, 1400)).toBe(2)
  })

  it('0.6.8 合併後的實測尺寸會降倍率，避免撐爆 canvas', () => {
    // 實測 1140×3885：scale 2 時是 17.7M px²，超過上限
    const s = pdfScaleFor(1140, 3885)
    expect(s).toBeLessThan(2)
    // 開根號回推必然剛好落在上限，留一點浮點餘裕（實測差 1.9e-9）
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
