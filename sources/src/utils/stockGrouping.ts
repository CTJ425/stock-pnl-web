/**
 * Utility for auto-grouping watchlist stocks by industry / category.
 *
 * Rule:
 * - When items in the same industry/category have count >= 2, they automatically form a group.
 * - Single items (count == 1) or items without classification fall back to '其他' (other).
 * - Standardizes badge names (e.g. '航運' -> '航運業', '半導體' -> '半導體業').
 */
import { getStockCategory } from './stockCategory'

/**
 * Canonical TWSE/TPEx industry standard names and their aliases.
 */
const CANONICAL_INDUSTRY_MAP: Record<string, string> = {
  水泥: '水泥工業',
  水泥業: '水泥工業',
  水泥工業: '水泥工業',

  食品: '食品工業',
  食品業: '食品工業',
  食品工業: '食品工業',

  塑膠: '塑膠工業',
  塑膠業: '塑膠工業',
  塑膠工業: '塑膠工業',

  紡織: '紡織纖維',
  紡織業: '紡織纖維',
  紡織纖維: '紡織纖維',
  紡織纖維業: '紡織纖維',

  電機: '電機機械',
  電機業: '電機機械',
  電機機械: '電機機械',
  電機機械業: '電機機械',

  電纜: '電器電纜',
  電器電纜: '電器電纜',
  電器電纜業: '電器電纜',

  化學: '化學工業',
  化學業: '化學工業',
  化學工業: '化學工業',

  生技: '生技醫療業',
  醫療: '生技醫療業',
  生技醫療: '生技醫療業',
  生技醫療業: '生技醫療業',

  玻璃: '玻璃陶瓷',
  玻璃陶瓷: '玻璃陶瓷',
  玻璃陶瓷業: '玻璃陶瓷',

  造紙: '造紙工業',
  造紙業: '造紙工業',
  造紙工業: '造紙工業',

  鋼鐵: '鋼鐵工業',
  鋼鐵業: '鋼鐵工業',
  鋼鐵工業: '鋼鐵工業',

  橡膠: '橡膠工業',
  橡膠業: '橡膠工業',
  橡膠工業: '橡膠工業',

  汽車: '汽車工業',
  汽車業: '汽車工業',
  汽車工業: '汽車工業',

  建材營造: '建材營造',
  建材營造業: '建材營造',
  營建: '建材營造',
  營造: '建材營造',

  航運: '航運業',
  航運業: '航運業',
  海運: '航運業',
  航空: '航運業',

  觀光: '觀光餐旅',
  觀光事業: '觀光餐旅',
  觀光餐旅: '觀光餐旅',
  觀光餐旅業: '觀光餐旅',

  金融: '金融保險業',
  金融保險: '金融保險業',
  金融保險業: '金融保險業',

  百貨: '貿易百貨業',
  貿易百貨: '貿易百貨業',
  貿易百貨業: '貿易百貨業',

  油電燃氣: '油電燃氣業',
  油電燃氣業: '油電燃氣業',

  綜合: '綜合',
  綜合業: '綜合',

  其他: '其他',
  其他業: '其他',
  其他類: '其他',

  半導體: '半導體業',
  半導體業: '半導體業',

  電腦週邊: '電腦及週邊設備業',
  電腦週邊業: '電腦及週邊設備業',
  電腦及週邊: '電腦及週邊設備業',
  電腦及週邊設備: '電腦及週邊設備業',
  電腦及週邊設備業: '電腦及週邊設備業',

  光電: '光電業',
  光電業: '光電業',

  網通: '通信網路業',
  通信網路: '通信網路業',
  通信網路業: '通信網路業',

  電子零組件: '電子零組件業',
  電子零組件業: '電子零組件業',

  電子通路: '電子通路業',
  電子通路業: '電子通路業',

  資服: '資訊服務業',
  資訊服務: '資訊服務業',
  資訊服務業: '資訊服務業',

  其他電子: '其他電子業',
  其他電子業: '其他電子業',

  文創: '文化創意業',
  文化創意: '文化創意業',
  文化創意業: '文化創意業',

  農業科技: '農業科技業',
  農業科技業: '農業科技業',

  電商: '電子商務業',
  電子商務: '電子商務業',
  電子商務業: '電子商務業',

  綠能: '綠能環保',
  綠能環保: '綠能環保',
  綠能環保業: '綠能環保',

  雲端: '數位雲端',
  數位雲端: '數位雲端',
  數位雲端業: '數位雲端',

  運動休閒: '運動休閒',
  運動休閒業: '運動休閒',

  居家生活: '居家生活',
  居家生活業: '居家生活',
}

/**
 * Standardizes category badge names into standard group titles.
 * E.g., '航運' -> '航運業', '半導體' -> '半導體業', while keeping ETF / ETN / special asset names intact.
 */
export function getGroupCategoryName(category: string): string {
  const c = category.trim()
  if (!c) return ''
  if (['債券 ETF', '股票型 ETF', '槓桿 ETF', '反向 ETF', 'ETN', 'TDR', 'REITs', '特別股'].includes(c)) {
    return c
  }
  if (CANONICAL_INDUSTRY_MAP[c]) {
    return CANONICAL_INDUSTRY_MAP[c]
  }
  if (c.endsWith('業') || c.endsWith('工業')) {
    return c
  }
  return `${c}業`
}

export interface WatchGroup<T> {
  key: string
  name: string
  isClustered: boolean
  items: T[]
}

export interface WatchGroupingResult<T> {
  hasGroups: boolean
  groups: WatchGroup<T>[]
  groupCounts: Map<string, number>
  clusteredGroupNames: string[]
  otherCount: number
}

/**
 * Groups watchlist items by resolved category.
 * If at least one category has count >= 2, auto-grouping is triggered.
 */
export function groupWatchItems<T extends { ticker: string; name: string }>(
  items: T[],
  getIndustry?: (item: T) => string | null | undefined,
): WatchGroupingResult<T> {
  if (items.length === 0) {
    return {
      hasGroups: false,
      groups: [],
      groupCounts: new Map(),
      clusteredGroupNames: [],
      otherCount: 0,
    }
  }

  // 1. Resolve group name for each item
  const itemGroupMap = new Map<T, string | null>()
  const groupCounts = new Map<string, number>()
  const groupOrder: string[] = []

  for (const item of items) {
    const rawCategory = getStockCategory(item.ticker, item.name, getIndustry?.(item))
    const groupName = rawCategory ? getGroupCategoryName(rawCategory) : null
    itemGroupMap.set(item, groupName)

    if (groupName && groupName !== '其他') {
      const prev = groupCounts.get(groupName) ?? 0
      groupCounts.set(groupName, prev + 1)
      if (prev === 0) {
        groupOrder.push(groupName)
      }
    }
  }

  // 2. Identify clustered groups (count >= 2)
  const clusteredGroupNames = groupOrder.filter((name) => (groupCounts.get(name) ?? 0) >= 2)
  const hasGroups = clusteredGroupNames.length > 0

  if (!hasGroups) {
    return {
      hasGroups: false,
      groups: [{ key: 'all', name: '全部', isClustered: false, items }],
      groupCounts,
      clusteredGroupNames: [],
      otherCount: items.length,
    }
  }

  // 3. Assemble clustered groups and '其他'
  const clusteredSet = new Set(clusteredGroupNames)
  const groups: WatchGroup<T>[] = []

  for (const name of clusteredGroupNames) {
    const groupItems = items.filter((item) => itemGroupMap.get(item) === name)
    groups.push({
      key: name,
      name,
      isClustered: true,
      items: groupItems,
    })
  }

  const otherItems = items.filter((item) => {
    const g = itemGroupMap.get(item)
    return !g || !clusteredSet.has(g)
  })

  if (otherItems.length > 0) {
    groups.push({
      key: '__other__',
      name: '其他',
      isClustered: false,
      items: otherItems,
    })
  }

  return {
    hasGroups: true,
    groups,
    groupCounts,
    clusteredGroupNames,
    otherCount: otherItems.length,
  }
}
