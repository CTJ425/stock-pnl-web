/**
 * Front-end file download helper.
 *
 * 0.9.17 removed the PDF export UI. The generator behind it (`generatePdfBlob`) had no caller
 * after that, so it went away together with the jspdf / html2canvas dependencies and the
 * `.report-surface` token overrides in index.css. Only the blob download step is still in use:
 * AppShell and the admin bulk export call it.
 */

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
