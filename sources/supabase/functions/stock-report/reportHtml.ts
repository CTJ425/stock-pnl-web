/**
 * 由 ReportData 產生自包含 HTML。
 * - reportBodyHtml：含 scoped <style> 的片段，前端注入 Modal、供 html2canvas 擷取成 PDF
 * - reportDocument：完整 <!doctype html> 文件
 * 所有動態字串以 esc() 轉義；顏色採台灣看盤慣例（紅漲/買超、綠跌/賣超）。
 */
import type { ReportData } from './report.ts'

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const base = Math.round(n).toLocaleString('en-US')
  return n > 0 ? `+${base}` : base
}

/** 張數（1 張 = 1000 股），四捨五入到整數張 */
function fmtLot(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const lots = Math.round(n / 1000)
  return `${lots > 0 ? '+' : ''}${lots.toLocaleString('en-US')} 張`
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}NT$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
}

function fmtSignedMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n > 0 ? `+${fmtMoney(n)}` : fmtMoney(n)
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(2)}%`
}

function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 買賣超 / 損益顏色 class（紅正綠負） */
function sc(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return 'flat'
  return n > 0 ? 'up' : 'down'
}

const STYLE = `
.rpt{font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif;color:#1a1d24;background:#fff;max-width:720px;margin:0 auto;padding:20px;box-sizing:border-box}
.rpt *{box-sizing:border-box}
.rpt h1{font-size:20px;margin:0 0 2px}
.rpt .sub{color:#5b6472;font-size:12px;margin-bottom:14px}
.rpt h2{font-size:14px;margin:18px 0 8px;padding-bottom:4px;border-bottom:2px solid #e3e7ee}
.rpt table{width:100%;border-collapse:collapse;font-size:13px}
.rpt th,.rpt td{padding:6px 8px;border-bottom:1px solid #eceef2;text-align:right}
.rpt th:first-child,.rpt td:first-child{text-align:left;color:#5b6472}
.rpt .cards{display:flex;flex-wrap:wrap;gap:10px}
.rpt .card{flex:1 1 140px;border:1px solid #e3e7ee;border-radius:8px;padding:10px 12px}
.rpt .card .k{font-size:11px;color:#5b6472}
.rpt .card .v{font-size:16px;font-weight:600;margin-top:2px}
.rpt .up{color:#d21f3c}
.rpt .down{color:#12864e}
.rpt .flat{color:#1a1d24}
.rpt .notes{font-size:12px;color:#8a94a3;margin-top:6px}
.rpt .notes li{margin:2px 0}
.rpt .disclaimer{margin-top:16px;padding:10px 12px;background:#f6f7f9;border-radius:8px;font-size:11px;color:#8a94a3;line-height:1.5}
`

function holdingSection(d: ReportData): string {
  const h = d.holding
  if (!h) return ''
  return `
  <h2>持股概況</h2>
  <div class="cards">
    <div class="card"><div class="k">持有股數</div><div class="v">${fmtInt(h.qty)}</div></div>
    <div class="card"><div class="k">平均成本</div><div class="v">${fmtPrice(h.avgCost)}</div></div>
    <div class="card"><div class="k">現價</div><div class="v">${fmtPrice(h.price)}</div></div>
    <div class="card"><div class="k">未實現損益</div><div class="v ${sc(h.unrealized)}">${fmtSignedMoney(h.unrealized)}</div></div>
    <div class="card"><div class="k">未實現報酬率</div><div class="v ${sc(h.roi)}">${fmtPct(h.roi)}</div></div>
  </div>`
}

function institutionalSection(d: ReportData): string {
  const i = d.institutional
  if (!i) return '<h2>三大法人買賣超</h2><p class="notes">查無此股當日資料。</p>'
  const row = (label: string, n: number | null) =>
    `<tr><td>${label}</td><td class="${sc(n)}">${fmtSigned(n)}</td><td class="${sc(n)}">${fmtLot(n)}</td></tr>`
  return `
  <h2>三大法人買賣超（當日）</h2>
  <table>
    <thead><tr><th>法人</th><th>買賣超股數</th><th>約當張數</th></tr></thead>
    <tbody>
      ${row('外資（不含自營）', i.foreign)}
      ${row('外資自營商', i.foreignDealer)}
      ${row('投信', i.trust)}
      ${row('自營商', i.dealer)}
      <tr style="font-weight:600"><td>三大法人合計</td><td class="${sc(i.total)}">${fmtSigned(i.total)}</td><td class="${sc(i.total)}">${fmtLot(i.total)}</td></tr>
    </tbody>
  </table>`
}

function marginSection(d: ReportData): string {
  const m = d.margin
  if (!m) return '<h2>融資融券</h2><p class="notes">查無此股當日資料。</p>'
  return `
  <h2>融資融券餘額（當日）</h2>
  <table>
    <thead><tr><th></th><th>今日餘額</th><th>較前日變化</th><th>限額</th></tr></thead>
    <tbody>
      <tr><td>融資</td><td>${fmtInt(m.marginToday)}</td><td class="${sc(m.marginChange)}">${fmtSigned(m.marginChange)}</td><td>${fmtInt(m.marginLimit)}</td></tr>
      <tr><td>融券</td><td>${fmtInt(m.shortToday)}</td><td class="${sc(m.shortChange)}">${fmtSigned(m.shortChange)}</td><td>${fmtInt(m.shortLimit)}</td></tr>
    </tbody>
  </table>
  <p class="notes">資券互抵：${fmtInt(m.offset)} 股</p>`
}

function borrowSection(d: ReportData): string {
  const b = d.borrow
  if (!b) return ''
  return `<h2>借券</h2><p class="notes">借券賣出可用股數：${fmtInt(b.availableVolume)} 股</p>`
}

function notesSection(d: ReportData): string {
  if (d.notes.length === 0) return ''
  return `<ul class="notes">${d.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
}

/** 前端注入用片段（含 scoped style） */
export function reportBodyHtml(d: ReportData): string {
  return `<style>${STYLE}</style>
<div class="rpt">
  <h1>${esc(d.ticker)} ${esc(d.name)}｜盤後籌碼</h1>
  <div class="sub">資料日期：${esc(d.dataDate)}（最近交易日盤後）</div>
  ${holdingSection(d)}
  ${institutionalSection(d)}
  ${marginSection(d)}
  ${borrowSection(d)}
  ${notesSection(d)}
  <div class="disclaimer">數據來源：臺灣證券交易所（TWSE）官方揭露，為最近交易日盤後資料。本報告僅彙整公開數據供參考，非投資建議；實際請以官方揭露為準。</div>
</div>`
}

/** 存檔用完整文件 */
export function reportDocument(d: ReportData): string {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.ticker)} ${esc(d.name)} 盤後籌碼 ${esc(d.dataDate)}</title></head><body>${reportBodyHtml(d)}</body></html>`
}
