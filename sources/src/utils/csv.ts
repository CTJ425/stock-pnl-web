/**
 * CSV 匯入 / 匯出 — 舊資料搬遷的關鍵路徑
 *
 * 匯入支援兩種格式：
 * 1. 舊 Google 試算表「個股交易紀錄」分頁匯出的 CSV：
 *    交易日期,股票代號,股票名稱,交易類型,交易單價,交易股數,手續費 / 稅金[,損益/收支]
 *    - 台股代號帶 'TPE:' 前綴（如 TPE:2330）→ 拆解為 market='TPE' + ticker='2330'
 *    - 交易類型為中文「買入 / 賣出」→ 轉為 'BUY' / 'SELL'
 * 2. 本應用匯出的 CSV（多一欄「市場」，代號不帶前綴）
 */
import type { Market, NewTransaction, Transaction, TxType } from '../types/models'
import { TX_TYPE_LABEL } from '../types/models'

export interface CsvRowError {
  /** 原始檔案中的列號（1-based，含表頭） */
  line: number
  message: string
}

export interface CsvImportResult {
  rows: NewTransaction[]
  errors: CsvRowError[]
  /** 資料列總數（不含表頭與空白列） */
  total: number
}

/** 輕量 CSV 解析：支援引號欄位、跳脫雙引號與 CRLF */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 支援 2026/07/15、2026-07-15（含補零與日期有效性檢查），回傳 YYYY-MM-DD */
export function parseTxDate(value: string): string | null {
  const m = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (!m) return null
  const [, y, mo, d] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseNumber(value: string): number {
  // 容忍 Google Sheets 匯出可能帶有的貨幣符號與千分位
  const cleaned = value.replace(/(NT\$|US\$|\$|,|\s)/g, '')
  if (cleaned === '') return NaN
  return Number(cleaned)
}

function parseTxType(value: string): TxType | null {
  const v = value.trim().toUpperCase()
  if (v === 'BUY' || v === '買入') return 'BUY'
  if (v === 'SELL' || v === '賣出') return 'SELL'
  return null
}

/** 台股代號樣式（3-6 位數字，可帶一碼英文尾碼），供無市場資訊時的啟發式判斷 */
const TW_TICKER_RE = /^\d{3,6}[A-Z]?$/

function parseMarket(rawTicker: string, marketCell: string): { market: Market; ticker: string } | null {
  let ticker = rawTicker.trim().toUpperCase()
  if (!ticker) return null

  if (ticker.startsWith('TPE:')) {
    return { market: 'TPE', ticker: ticker.slice(4) }
  }

  const m = marketCell.trim().toUpperCase()
  if (m === 'TPE' || m === '台股') return { market: 'TPE', ticker }
  if (m === 'US' || m === '美股') return { market: 'US', ticker }

  // 無市場資訊（舊格式無前綴者視為美股；純數字代號視為台股）
  return { market: TW_TICKER_RE.test(ticker) ? 'TPE' : 'US', ticker }
}

/** 表頭正規化：去除空白與斜線（「手續費 / 稅金」與「手續費/稅金」視為相同） */
function normalizeHeader(cell: string): string {
  return cell.replace(/[\s/]/g, '')
}

export function parseTransactionsCsv(text: string): CsvImportResult {
  const result: CsvImportResult = { rows: [], errors: [], total: 0 }
  const table = parseCsv(text)
  if (table.length === 0) {
    result.errors.push({ line: 1, message: '檔案內容為空' })
    return result
  }

  const header = table[0].map(normalizeHeader)

  // 舊版（v0.2）「全部工作區」總覽匯出的備份檔含「工作區」欄；若其中有多個工作區，
  // 擋下整批匯入——不同券商的交易混進同一工作區會污染移動平均成本
  const wsCol = header.indexOf('工作區')
  if (wsCol >= 0) {
    const wsNames = new Set<string>()
    for (let i = 1; i < table.length; i++) {
      const cells = table[i]
      if (cells.every((c) => c.trim() === '')) continue
      const name = (cells[wsCol] ?? '').trim()
      if (name) wsNames.add(name)
    }
    if (wsNames.size > 1) {
      result.errors.push({
        line: 1,
        message:
          '此檔案為「全部工作區」總覽匯出，含多個工作區的交易。為避免不同券商的成本互相污染，請先依「工作區」欄拆分後，分別匯入對應的工作區。',
      })
      return result
    }
  }

  const col = {
    date: header.indexOf('交易日期'),
    market: header.indexOf('市場'),
    ticker: header.indexOf('股票代號'),
    name: header.indexOf('股票名稱'),
    type: header.indexOf('交易類型'),
    price: header.indexOf('交易單價'),
    qty: header.indexOf('交易股數'),
    fee: header.findIndex((h) => h.includes('手續費')),
  }
  if (col.date < 0 || col.ticker < 0 || col.type < 0 || col.price < 0 || col.qty < 0) {
    result.errors.push({
      line: 1,
      message:
        '表頭缺少必要欄位（需含：交易日期、股票代號、交易類型、交易單價、交易股數）',
    })
    return result
  }

  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    const line = i + 1
    if (cells.every((c) => c.trim() === '')) continue // 跳過空白列
    result.total++

    const at = (idx: number) => (idx >= 0 && idx < cells.length ? cells[idx] : '')

    const txDate = parseTxDate(at(col.date))
    if (!txDate) {
      result.errors.push({ line, message: `交易日期格式錯誤：「${at(col.date)}」` })
      continue
    }

    const mt = parseMarket(at(col.ticker), at(col.market))
    if (!mt) {
      result.errors.push({ line, message: '股票代號為空' })
      continue
    }

    const txType = parseTxType(at(col.type))
    if (!txType) {
      result.errors.push({ line, message: `交易類型無法辨識：「${at(col.type)}」` })
      continue
    }

    const price = parseNumber(at(col.price))
    if (!Number.isFinite(price) || price < 0) {
      result.errors.push({ line, message: `交易單價無效：「${at(col.price)}」` })
      continue
    }

    const qty = parseNumber(at(col.qty))
    if (!Number.isFinite(qty) || qty <= 0) {
      result.errors.push({ line, message: `交易股數無效：「${at(col.qty)}」` })
      continue
    }

    let feeTax = 0
    const feeRaw = at(col.fee).trim()
    if (feeRaw !== '') {
      feeTax = parseNumber(feeRaw)
      if (!Number.isFinite(feeTax) || feeTax < 0) {
        result.errors.push({ line, message: `手續費 / 稅金無效：「${feeRaw}」` })
        continue
      }
    }

    result.rows.push({
      tx_date: txDate,
      market: mt.market,
      ticker: mt.ticker,
      name: at(col.name).trim() || mt.ticker,
      tx_type: txType,
      price,
      qty,
      fee_tax: feeTax,
    })
  }

  return result
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** 匯出為 CSV（含 BOM 供 Excel 正確辨識 UTF-8；交易類型以中文輸出、可再匯入） */
export function transactionsToCsv(txs: Transaction[]): string {
  const header = ['交易日期', '市場', '股票代號', '股票名稱', '交易類型', '交易單價', '交易股數', '手續費 / 稅金']
  const lines = [header.join(',')]
  for (const tx of txs) {
    lines.push(
      [
        tx.tx_date,
        tx.market,
        tx.ticker,
        csvField(tx.name),
        TX_TYPE_LABEL[tx.tx_type],
        String(tx.price),
        String(tx.qty),
        String(tx.fee_tax),
      ].join(','),
    )
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
