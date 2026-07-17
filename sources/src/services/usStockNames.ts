/**
 * 常見美股中文名稱對照表（zh-TW 慣用譯名）：
 * - 顯示層：美股名稱以中文顯示（表中沒有的維持原名）
 * - 搜尋層：支援用中文關鍵字反查美股代號（Yahoo 搜尋不支援中文，
 *   Edge Function 不可用時也能離線運作）
 */
import type { Market } from '../types/models'

export interface UsZhEntry {
  symbol: string
  name: string
}

const US_STOCK_ZH_NAMES: Record<string, string> = {
  // --- 科技巨頭 ---
  AAPL: '蘋果',
  MSFT: '微軟',
  GOOGL: '谷歌 Alphabet',
  GOOG: '谷歌 Alphabet',
  AMZN: '亞馬遜',
  NVDA: '輝達',
  META: 'Meta（臉書）',
  TSLA: '特斯拉',
  NFLX: '網飛',
  ORCL: '甲骨文',
  CRM: 'Salesforce',
  ADBE: 'Adobe',
  UBER: '優步',
  ABNB: 'Airbnb',
  PYPL: 'PayPal',
  SHOP: 'Shopify',
  PLTR: 'Palantir',
  COIN: 'Coinbase',
  // --- 半導體 ---
  TSM: '台積電 ADR',
  AVGO: '博通',
  AMD: '超微',
  INTC: '英特爾',
  QCOM: '高通',
  MU: '美光',
  TXN: '德州儀器',
  AMAT: '應用材料',
  LRCX: '科林研發',
  KLAC: '科磊',
  ASML: '艾司摩爾',
  ARM: '安謀',
  CSCO: '思科',
  // --- 消費 / 零售 ---
  COST: '好市多',
  WMT: '沃爾瑪',
  MCD: '麥當勞',
  SBUX: '星巴克',
  NKE: '耐吉',
  KO: '可口可樂',
  PEP: '百事',
  PG: '寶僑',
  DIS: '迪士尼',
  BKNG: 'Booking',
  // --- 醫療 ---
  JNJ: '嬌生',
  PFE: '輝瑞',
  MRK: '默沙東',
  LLY: '禮來',
  ABBV: '艾伯維',
  MRNA: '莫德納',
  UNH: '聯合健康',
  AMGN: '安進',
  GILD: '吉利德',
  ISRG: '直覺手術',
  // --- 金融 ---
  JPM: '摩根大通',
  GS: '高盛',
  MS: '摩根士丹利',
  BAC: '美國銀行',
  C: '花旗',
  WFC: '富國銀行',
  AXP: '美國運通',
  V: 'Visa',
  MA: '萬事達卡',
  BLK: '貝萊德',
  SCHW: '嘉信理財',
  // --- 能源 / 工業 ---
  XOM: '埃克森美孚',
  CVX: '雪佛龍',
  BA: '波音',
  LMT: '洛克希德馬丁',
  RTX: '雷神技術',
  CAT: '開拓重工',
  GE: '奇異',
  MMM: '3M',
  HON: '漢威',
  FDX: '聯邦快遞',
  UPS: '優比速',
  F: '福特',
  GM: '通用汽車',
  // --- 電信 / 媒體 ---
  T: 'AT&T',
  VZ: '威訊',
  TMUS: 'T-Mobile',
  CMCSA: '康卡斯特',
  // --- 中概股 ---
  BABA: '阿里巴巴',
  JD: '京東',
  PDD: '拼多多',
  BIDU: '百度',
  NTES: '網易',
  NIO: '蔚來',
  LI: '理想汽車',
  XPEV: '小鵬汽車',
  // --- 熱門 ETF ---
  SPY: 'SPDR 標普 500 ETF',
  VOO: 'Vanguard 標普 500 ETF',
  IVV: 'iShares 標普 500 ETF',
  QQQ: 'Invesco 那斯達克 100 ETF',
  VTI: 'Vanguard 整體股市 ETF',
  VT: 'Vanguard 全世界股票 ETF',
  SCHD: 'Schwab 高股息 ETF',
  SMH: '范達半導體 ETF',
  SOXX: 'iShares 半導體 ETF',
  TLT: 'iShares 20 年期以上美債 ETF',
  JEPI: 'JPMorgan 股票溢價收益 ETF',
  JEPQ: 'JPMorgan 那斯達克溢價收益 ETF',
  TQQQ: '三倍做多那斯達克 100 ETF',
  SOXL: '三倍做多半導體 ETF',
  ARKK: '方舟創新 ETF',
}

/** 代號查中文名；表中沒有時回傳 null */
export function usZhName(symbol: string): string | null {
  return US_STOCK_ZH_NAMES[symbol.toUpperCase()] ?? null
}

/** 以中文關鍵字或代號前綴搜尋對照表 */
export function searchUsZhNames(
  query: string,
  limit = 10,
): Array<{ symbol: string; name: string; market: Market }> {
  const q = query.trim()
  if (!q) return []
  const upper = q.toUpperCase()
  const out: Array<{ symbol: string; name: string; market: Market }> = []
  for (const [symbol, name] of Object.entries(US_STOCK_ZH_NAMES)) {
    if (symbol.startsWith(upper) || name.includes(q)) {
      out.push({ symbol, name, market: 'US' })
      if (out.length >= limit) break
    }
  }
  return out
}

/** 顯示層名稱：美股優先採中文譯名，其餘（含台股）維持原始名稱 */
export function displayStockName(market: Market, ticker: string, name: string): string {
  if (market === 'US') return usZhName(ticker) ?? name
  return name
}
