/**
 * 前端把報告 DOM 轉成 PDF blob。
 * 用 html2canvas 擷取（瀏覽器直接渲染中文，免處理 CJK 字型嵌入），
 * 再以 jsPDF 內嵌影像；內容高於一頁時自動分頁。
 * html2canvas / jsPDF 較大，改為動態載入：只在使用者按「下載 PDF」時才載入，
 * 不進主 bundle。
 */

/**
 * 擷取期間套在容器上的 class（見 index.css）：把 --surface / --ink / --border 等 token
 * 覆寫成淺色，深色主題也能輸出像文件的淺色 PDF。擷取完立刻移除，畫面不受影響。
 */
const SURFACE_CLASS = 'report-surface'

/**
 * canvas 面積上限（px²）。
 *
 * **iOS Safari 對單一 canvas 的面積有硬性上限（約 16.7M px²），超過就靜默失敗** ——
 * `toDataURL()` 回空白，使用者只會看到「PDF 產生失敗」。這裡取 16M 留一點餘裕。
 *
 * 0.6.8 把四段併成一頁之後這條線就踩到了：實測擷取範圍 1140×3885 CSS px，
 * 在 scale 2 下是 2280×7772 ＝ **17.7M px²**，剛好越過去。
 */
const MAX_CANVAS_AREA = 16_000_000

/**
 * 依內容面積決定擷取倍率。
 *
 * 內容短時維持 scale 2（既有畫質不變）；長到會撐爆 canvas 時逐步降，
 * **寧可略降解析度也不要產出一份空白 PDF**。下限 1 是為了讓文字仍然讀得出來。
 */
export function pdfScaleFor(cssWidth: number, cssHeight: number): number {
  const area = Math.max(cssWidth * cssHeight, 1)
  return Math.max(1, Math.min(2, Math.sqrt(MAX_CANVAS_AREA / area)))
}

export async function generatePdfBlob(el: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])
  let canvas: HTMLCanvasElement
  const scale = pdfScaleFor(el.scrollWidth, el.scrollHeight)
  el.classList.add(SURFACE_CLASS)
  try {
    canvas = await html2canvas(el, { scale, backgroundColor: '#ffffff', useCORS: true })
  } finally {
    el.classList.remove(SURFACE_CLASS)
  }
  const img = canvas.toDataURL('image/jpeg', 0.92)

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const imgW = pageW
  const imgH = (canvas.height * pageW) / canvas.width

  if (imgH <= pageH) {
    pdf.addImage(img, 'JPEG', 0, 0, imgW, imgH)
  } else {
    // 單張長圖跨頁：每頁往上位移一個頁高，只顯示該頁對應的切片
    let remaining = imgH
    let position = 0
    while (remaining > 0) {
      pdf.addImage(img, 'JPEG', 0, position, imgW, imgH)
      remaining -= pageH
      if (remaining > 0) {
        pdf.addPage()
        position -= pageH
      }
    }
  }
  return pdf.output('blob')
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
