/**
 * CSV import/export – critical path for migrating old data
 *
 * Import supports two formats:
 * 1. CSV exported from the "Individual Stock Transaction Records" page of the old Google spreadsheet:
 *    Transaction date, stock code, stock name, transaction type, transaction unit price, number of shares traded, handling fees/taxes [, profit and loss/income and expenses]
 *    - Taiwan stock code with 'TPE:' prefix (such as TPE:2330) → broken down into market='TPE' + ticker='2330'
 *    - The transaction type is "Buy/Sell" in Chinese → converted to 'BUY' / 'SELL'
 * 2. CSV exported by this application (one more column "Market", code without prefix)
 */
import type { Market, NewTransaction, Transaction, TxNature, TxType } from '../types/models'
import { TX_NATURE_LABEL, TX_TYPE_LABEL } from '../types/models'
import { splitFeeTax } from './pnlEngine'

export interface CsvRowError {
  /** Column number in the original file (1-based, including header)*/
  line: number
  message: string
}

export interface CsvImportResult {
  rows: NewTransaction[]
  errors: CsvRowError[]
  /** Total number of data columns (excluding headers and blank columns)*/
  total: number
}

/** Lightweight CSV parsing: support for quote fields, escaping double quotes and CRLF*/
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

/** Supports 2026/07/15, 2026-07-15 (including zero padding and date validity check), returns YYYY-MM-DD*/
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
  // Accounting negative form, e.g. "(1,000)", must be detected before stripping parens
  const isParenNeg = /^\(.*\)$/.test(value.trim())
  // Tolerate possible currency symbols and thousandths in Google Sheets exports
  const cleaned = value.replace(/(NT\$|US\$|\$|,|\s|\(|\))/g, '')
  if (cleaned === '') return NaN
  const num = Number(cleaned)
  // Negate the magnitude, not the parsed value: "(-500)" carries both markers and would
  // otherwise flip to +500 and pass the `>= 0` column checks instead of being rejected.
  return isParenNeg ? -Math.abs(num) : num
}

function parseTxType(value: string): TxType | null {
  const v = value.trim().toUpperCase()
  if (v === 'BUY' || v === '買入') return 'BUY'
  if (v === 'SELL' || v === '賣出') return 'SELL'
  return null
}

/** Accepts the Chinese label and the code (case-insensitively); empty stays absent, not an error*/
function parseTxNature(value: string): TxNature | null {
  const trimmed = value.trim()
  if (trimmed === '現股') return 'SPOT'
  if (trimmed === '當沖') return 'DAY_TRADE'
  if (trimmed === '融資') return 'MARGIN'
  const v = trimmed.toUpperCase()
  if (v === 'SPOT' || v === 'DAY_TRADE' || v === 'MARGIN') return v
  return null
}

/** Taiwan stock code format (3-6 digits, with an English suffix) for heuristic judgment when there is no market information*/
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

  // No market information (those with no prefix in the old format are regarded as US stocks; pure numeric codes are regarded as Taiwan stocks)
  return { market: TW_TICKER_RE.test(ticker) ? 'TPE' : 'US', ticker }
}

/** Header normalization: remove blanks and slashes ("Fees/Taxes" and "Fees/Taxes" are considered the same)*/
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

  // The backup file exported by the "All Workspaces" overview of the old version (v0.2) contains the "Workspace" column; if there are multiple workspaces,
  // Block the entire batch of imports - the mixing of transactions from different brokers into the same workspace will contaminate the moving average cost
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
          '這個檔案含有多個工作區的交易。請先依「工作區」欄拆開，再分別匯入各自的工作區，成本才不會混在一起。',
      })
      return result
    }
  }

  // Split fee/tax columns must match exactly: `'手續費'.includes('手續費')` is true, so the
  // legacy `includes()` match below would otherwise swallow the split column as the combined total.
  const feeSplitCol = header.indexOf('手續費')
  const taxSplitCol = header.indexOf('證交稅')
  const splitMode = feeSplitCol >= 0 && taxSplitCol >= 0

  const col = {
    date: header.indexOf('交易日期'),
    market: header.indexOf('市場'),
    ticker: header.indexOf('股票代號'),
    name: header.indexOf('股票名稱'),
    type: header.indexOf('交易類型'),
    nature: header.indexOf('交易性質'),
    price: header.indexOf('交易單價'),
    qty: header.indexOf('交易股數'),
    fee: splitMode ? -1 : header.findIndex((h) => h.includes('手續費')),
    feeSplit: feeSplitCol,
    taxSplit: taxSplitCol,
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
    if (splitMode) {
      let fee = 0
      const feeRaw = at(col.feeSplit).trim()
      if (feeRaw !== '') {
        fee = parseNumber(feeRaw)
        if (!Number.isFinite(fee) || fee < 0) {
          result.errors.push({ line, message: `手續費無效：「${feeRaw}」` })
          continue
        }
      }
      let tax = 0
      const taxRaw = at(col.taxSplit).trim()
      if (taxRaw !== '') {
        tax = parseNumber(taxRaw)
        if (!Number.isFinite(tax) || tax < 0) {
          result.errors.push({ line, message: `證交稅無效：「${taxRaw}」` })
          continue
        }
      }
      feeTax = fee + tax
    } else {
      const feeRaw = at(col.fee).trim()
      if (feeRaw !== '') {
        feeTax = parseNumber(feeRaw)
        if (!Number.isFinite(feeTax) || feeTax < 0) {
          result.errors.push({ line, message: `手續費 / 稅金無效：「${feeRaw}」` })
          continue
        }
      }
    }

    let txNature: TxNature | undefined
    if (col.nature >= 0) {
      const natureRaw = at(col.nature).trim()
      if (natureRaw !== '') {
        const parsed = parseTxNature(natureRaw)
        if (!parsed) {
          result.errors.push({ line, message: `交易性質無法辨識：「${natureRaw}」` })
          continue
        }
        txNature = parsed
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
      ...(txNature !== undefined ? { tx_nature: txNature } : {}),
    })
  }

  return result
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Export to CSV (including BOM for Excel to correctly recognize UTF-8; transaction type is output in Chinese and can be re-imported)*/
export function transactionsToCsv(txs: Transaction[]): string {
  const header = [
    '交易日期',
    '市場',
    '股票代號',
    '股票名稱',
    '交易類型',
    '交易性質',
    '交易單價',
    '交易股數',
    '手續費',
    '證交稅',
    '手續費 / 稅金',
  ]
  const lines = [header.join(',')]
  for (const tx of txs) {
    const { fee, tax } = splitFeeTax(tx)
    lines.push(
      [
        tx.tx_date,
        tx.market,
        tx.ticker,
        csvField(tx.name),
        TX_TYPE_LABEL[tx.tx_type],
        tx.tx_nature ? TX_NATURE_LABEL[tx.tx_nature] : '',
        String(tx.price),
        String(tx.qty),
        String(fee),
        String(tax),
        String(tx.fee_tax),
      ].join(','),
    )
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
