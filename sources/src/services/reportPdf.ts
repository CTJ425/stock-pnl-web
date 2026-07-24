/**
 * 前端把報告 DOM 轉成 PDF blob。
 * 用 html2canvas 擷取（瀏覽器直接渲染中文，免處理 CJK 字型嵌入），
 * 再以 jsPDF 內嵌影像；內容高於一頁時自動分頁。
 * html2canvas / jsPDF 較大，改為動態載入：只在使用者按「下載 PDF」時才載入，
 * 不進主 bundle。
 */
export async function generatePdfBlob(el: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
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
