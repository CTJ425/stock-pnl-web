/**
 * The front end converts the report DOM into a PDF blob.
 * Use html2canvas to capture (the browser directly renders Chinese without processing CJK font embedding),
 * Then use jsPDF to embed images; when the content is higher than one page, it will automatically break into pages.
 * html2canvas / jsPDF is larger, changed to dynamic loading: only loaded when the user clicks "Download PDF".
 * Not entering the main bundle.
 */

/**
 * Retrieve the class set on the container during retrieval (see index.css): put --surface / --ink / --border and other tokens
 * Overwriting to light and dark themes can also output light PDFs like documents. Remove it immediately after capturing, and the screen will not be affected.
 */
const SURFACE_CLASS = 'report-surface'

/**
 * The upper limit of canvas area (px²).
 *
 * **iOS Safari has a hard upper limit on the area of ​​a single canvas (about 16.7M px²), and it will fail silently if it exceeds it** ——
 * `toDataURL()` returns blank, the user will only see "PDF generation failed". Take 16M here to leave a little margin.
 *
 * 0.6.8 After merging the four paragraphs into one page, this line is stepped on: the measured capture range is 1140×3885 CSS px,
 * At scale 2 it is 2280×7772 = **17.7M px²**, which is just over.
 */
const MAX_CANVAS_AREA = 16_000_000

/**
 * The capture magnification is determined based on the content area.
 *
 * The content remains at scale 2 for a short period of time (the existing image quality remains unchanged); when it grows to the point where the canvas will burst, it will gradually decrease.
 * **It is better to reduce the resolution slightly rather than produce a blank PDF**. The lower limit of 1 is so that the text is still readable.
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
    // Single long image spread across pages: Each page is shifted upward by one page height, and only the slices corresponding to that page are displayed.
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
